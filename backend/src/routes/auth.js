'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getAccountByRiotId } = require('../services/riot');
const db = require('../db/client');

const router = express.Router();

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's database record.
 */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const privyUserId = req.user.id;
    
    const result = await db.query(
      'SELECT privy_user_id, wallet_address, riot_puuid, created_at FROM users WHERE privy_user_id = $1',
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
 * POST /api/auth/link-riot
 * Links a Privy User ID & Wallet Address to a Riot PUUID.
 * 
 * Body: {
 *   gameName: "Faker",
 *   tagLine: "KR1",
 *   walletAddress: "0x123..."
 * }
 */
router.post('/link-riot', requireAuth, async (req, res, next) => {
  try {
    const privyUserId = req.user.id;
    const { gameName, tagLine, walletAddress } = req.body;

    if (!gameName || !tagLine || !walletAddress) {
      return res.status(400).json({ error: 'gameName, tagLine, and walletAddress are required' });
    }

    // 1. Fetch the PUUID from Riot API
    const riotAccount = await getAccountByRiotId(gameName, tagLine);
    const puuid = riotAccount.puuid;

    // 2. Insert or update the database record
    // We use ON CONFLICT (privy_user_id) to update if the user already exists but is changing wallets or Riot IDs.
    // Note: riot_puuid has a UNIQUE constraint in the DB, so this will fail if another user already linked this PUUID.
    try {
      const result = await db.query(
        `INSERT INTO users (privy_user_id, wallet_address, riot_puuid)
         VALUES ($1, $2, $3)
         ON CONFLICT (privy_user_id) DO UPDATE 
         SET wallet_address = EXCLUDED.wallet_address,
             riot_puuid = EXCLUDED.riot_puuid
         RETURNING privy_user_id, wallet_address, riot_puuid`,
        [privyUserId, walletAddress, puuid]
      );

      res.status(200).json({
        message: 'Riot account linked successfully',
        user: result.rows[0],
        riot: {
          gameName: riotAccount.gameName,
          tagLine: riotAccount.tagLine
        }
      });
    } catch (dbError) {
      // Postgres error code 23505 is unique_violation
      if (dbError.code === '23505' && dbError.constraint === 'users_riot_puuid_key') {
        return res.status(409).json({ error: 'This Riot account is already linked to another user.' });
      }
      throw dbError;
    }

  } catch (error) {
    next(error);
  }
});

module.exports = router;
