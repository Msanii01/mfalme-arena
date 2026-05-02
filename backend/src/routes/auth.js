'use strict';

const crypto = require('crypto');
const express = require('express');
const { requireAuth, getCanonicalWallet } = require('../middleware/auth');
const { getAccountByRiotId, getSummonerByPuuid } = require('../services/riot');
const db = require('../db/client');

const router = express.Router();

const ATTEMPT_TTL_SECONDS = 10 * 60; // 10 minutes
const TOTAL_PROFILE_ICONS = 28;      // safe lower bound — Riot icons 0..27 always exist

/**
 * Pick a random profile icon ID for verification, avoiding the user's current icon
 * (otherwise they'd "verify" without doing anything).
 */
function pickTargetIcon(currentIconId) {
  for (let i = 0; i < 8; i++) {
    const candidate = crypto.randomInt(0, TOTAL_PROFILE_ICONS);
    if (candidate !== currentIconId) return candidate;
  }
  return (currentIconId + 1) % TOTAL_PROFILE_ICONS;
}

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's database record.
 */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const privyUserId = req.user.id;

    const result = await db.query(
      'SELECT user_id, privy_user_id, wallet_address, riot_puuid, created_at FROM users WHERE privy_user_id = $1',
      [privyUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User profile not found in database. Needs setup.' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/sync
 * Syncs a Privy User ID & Wallet Address into the database.
 */
router.post('/sync', requireAuth, async (req, res, next) => {
  try {
    const privyUserId = req.user.id;
    const walletAddress = await getCanonicalWallet(privyUserId);

    const result = await db.query(
      `INSERT INTO users (privy_user_id, wallet_address)
       VALUES ($1, $2)
       ON CONFLICT (privy_user_id) DO UPDATE
       SET wallet_address = EXCLUDED.wallet_address
       RETURNING user_id, privy_user_id, wallet_address, riot_puuid, created_at`,
      [privyUserId, walletAddress]
    );

    res.status(200).json({ user: result.rows[0] });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

/**
 * POST /api/auth/link-riot
 * Legacy unverified endpoint — disabled. Clients must use the
 * /link-riot/start + /link-riot/verify flow which proves ownership via
 * the user's profile-icon.
 */
router.post('/link-riot', requireAuth, (req, res) => {
  res.status(410).json({
    error: 'This endpoint has been replaced. Use POST /auth/link-riot/start and /auth/link-riot/verify.',
  });
});

/**
 * POST /api/auth/link-riot/start
 * Begins a Riot ownership proof. The user is asked to set their profile icon
 * to the returned `targetIconId`; calling /verify confirms the change.
 *
 * Body: { gameName, tagLine, platform } (platform e.g. 'na1', 'euw1')
 */
router.post('/link-riot/start', requireAuth, async (req, res, next) => {
  try {
    const privyUserId = req.user.id;
    const { gameName, tagLine, platform } = req.body || {};

    if (!gameName || !tagLine || !platform) {
      return res.status(400).json({ error: 'gameName, tagLine, and platform are required' });
    }

    const account = await getAccountByRiotId(gameName, tagLine);
    const puuid = account.puuid;

    // If another user has already verified this PUUID, block early with a clean error.
    const owner = await db.query('SELECT user_id, privy_user_id FROM users WHERE riot_puuid = $1', [puuid]);
    if (owner.rows.length > 0 && owner.rows[0].privy_user_id !== privyUserId) {
      return res.status(409).json({ error: 'This Riot account is already linked to another Mfalme player.' });
    }

    const summoner = await getSummonerByPuuid(puuid, platform);
    const targetIconId = pickTargetIcon(summoner.profileIconId);

    const expiresAt = new Date(Date.now() + ATTEMPT_TTL_SECONDS * 1000);

    // Invalidate any prior pending attempts for this user — only one open challenge at a time.
    await db.query(
      `UPDATE riot_link_attempts SET status = 'expired'
       WHERE privy_user_id = $1 AND status = 'pending'`,
      [privyUserId]
    );

    const insert = await db.query(
      `INSERT INTO riot_link_attempts
         (privy_user_id, puuid, game_name, tag_line, platform, target_icon_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING attempt_id, target_icon_id, expires_at`,
      [privyUserId, puuid, account.gameName, account.tagLine, platform.toLowerCase(), targetIconId, expiresAt]
    );

    res.json({
      attemptId: insert.rows[0].attempt_id,
      targetIconId: insert.rows[0].target_icon_id,
      currentIconId: summoner.profileIconId,
      expiresAt: insert.rows[0].expires_at,
      ttlSeconds: ATTEMPT_TTL_SECONDS,
      riot: {
        gameName: account.gameName,
        tagLine: account.tagLine,
        summonerLevel: summoner.summonerLevel,
      },
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

/**
 * POST /api/auth/link-riot/verify
 * Re-fetches the live summoner profile and finalizes the link if the icon
 * matches the attempt's targetIconId.
 *
 * Body: { attemptId }
 */
router.post('/link-riot/verify', requireAuth, async (req, res, next) => {
  try {
    const privyUserId = req.user.id;
    const { attemptId } = req.body || {};

    if (!attemptId) {
      return res.status(400).json({ error: 'attemptId is required' });
    }

    const attemptRes = await db.query(
      `SELECT attempt_id, privy_user_id, puuid, game_name, tag_line, platform,
              target_icon_id, status, expires_at
       FROM riot_link_attempts WHERE attempt_id = $1`,
      [attemptId]
    );

    if (attemptRes.rows.length === 0) {
      return res.status(404).json({ error: 'Verification attempt not found' });
    }
    const attempt = attemptRes.rows[0];

    if (attempt.privy_user_id !== privyUserId) {
      return res.status(403).json({ error: 'This verification attempt belongs to a different account' });
    }
    if (attempt.status !== 'pending') {
      return res.status(409).json({ error: `Attempt is ${attempt.status}` });
    }
    if (new Date(attempt.expires_at).getTime() < Date.now()) {
      await db.query(`UPDATE riot_link_attempts SET status='expired' WHERE attempt_id=$1`, [attemptId]);
      return res.status(410).json({ error: 'Verification window expired — start a new attempt.' });
    }

    const summoner = await getSummonerByPuuid(attempt.puuid, attempt.platform);

    if (summoner.profileIconId !== attempt.target_icon_id) {
      return res.status(400).json({
        error: 'Profile icon does not match yet. Make sure the new icon is saved in-game.',
        currentIconId: summoner.profileIconId,
        targetIconId: attempt.target_icon_id,
      });
    }

    const walletAddress = await getCanonicalWallet(privyUserId);

    try {
      const userRes = await db.query(
        `INSERT INTO users (privy_user_id, wallet_address, riot_puuid, riot_game_name, riot_tag_line)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (privy_user_id) DO UPDATE
         SET wallet_address = EXCLUDED.wallet_address,
             riot_puuid     = EXCLUDED.riot_puuid,
             riot_game_name = EXCLUDED.riot_game_name,
             riot_tag_line  = EXCLUDED.riot_tag_line
         RETURNING user_id, privy_user_id, wallet_address, riot_puuid, riot_game_name, riot_tag_line`,
        [privyUserId, walletAddress, attempt.puuid, attempt.game_name, attempt.tag_line]
      );

      await db.query(
        `UPDATE riot_link_attempts SET status='verified', verified_at=NOW() WHERE attempt_id=$1`,
        [attemptId]
      );

      res.json({
        message: 'Riot account linked successfully',
        user: userRes.rows[0],
        riot: { gameName: attempt.game_name, tagLine: attempt.tag_line },
      });
    } catch (dbError) {
      if (dbError.code === '23505' && dbError.constraint === 'users_riot_puuid_key') {
        return res.status(409).json({ error: 'This Riot account is already linked to another user.' });
      }
      throw dbError;
    }
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

module.exports = router;
