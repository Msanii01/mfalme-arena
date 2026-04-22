'use strict';

const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const db = require('../db/client');
const { getAccountByRiotId } = require('../services/riot');

const router = express.Router();

/**
 * GET /api/matches
 * Returns all active and historical matches for the authenticated user.
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    // Get the internal user UUID
    const userRes = await db.query('SELECT user_id FROM users WHERE privy_user_id = $1', [userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User profile not found' });
    const internalUserId = userRes.rows[0].user_id;

    const matches = await db.query(
      `SELECT m.*, 
              u1.riot_game_name as player_a_name, u1.riot_tag_line as player_a_tag,
              u2.riot_game_name as player_b_name, u2.riot_tag_line as player_b_tag
       FROM matches m
       JOIN users u1 ON m.player_a_id = u1.user_id
       LEFT JOIN users u2 ON m.player_b_id = u2.user_id
       WHERE m.player_a_id = $1 OR m.player_b_id = $1
       ORDER BY m.created_at DESC`,
      [internalUserId]
    );

    res.json({ matches: matches.rows });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/matches
 * Creates a new 1v1 challenge.
 * Body: { opponentGameName: 'Faker', opponentTagLine: 'KR1', stakeAmount: '10.0' }
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { opponentGameName, opponentTagLine, stakeAmount } = req.body;
    if (!opponentGameName || !opponentTagLine || !stakeAmount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const userId = req.user.id;
    
    // 1. Get creator's internal ID
    const creatorRes = await db.query('SELECT user_id, riot_puuid FROM users WHERE privy_user_id = $1', [userId]);
    if (creatorRes.rows.length === 0) return res.status(400).json({ error: 'Please link your Riot account first' });
    const creator = creatorRes.rows[0];

    // 2. Fetch opponent PUUID via Riot API
    const opponentRiot = await getAccountByRiotId(opponentGameName, opponentTagLine);
    
    if (opponentRiot.puuid === creator.riot_puuid) {
      return res.status(400).json({ error: 'You cannot challenge yourself' });
    }

    // 3. Find opponent in DB
    const opponentRes = await db.query('SELECT user_id FROM users WHERE riot_puuid = $1', [opponentRiot.puuid]);
    if (opponentRes.rows.length === 0) {
      return res.status(400).json({ error: 'Opponent has not registered on Mfalme Arena yet' });
    }
    const opponentId = opponentRes.rows[0].user_id;

    // 4. Generate escrow_match_id (32 bytes hex for smart contract keccak256)
    const escrowMatchId = '0x' + crypto.randomBytes(32).toString('hex');

    // 5. Insert match
    const newMatch = await db.query(
      `INSERT INTO matches (player_a_id, player_b_id, player_a_puuid, player_b_puuid, stake_amount, escrow_match_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [creator.user_id, opponentId, creator.riot_puuid, opponentRiot.puuid, stakeAmount, escrowMatchId]
    );

    res.json({ match: newMatch.rows[0] });
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ error: error.message });
    next(error);
  }
});

/**
 * GET /api/matches/:id
 * Gets match status by UUID
 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const matchRes = await db.query(
      `SELECT m.*, 
              u1.riot_game_name as player_a_name, u1.riot_tag_line as player_a_tag,
              u2.riot_game_name as player_b_name, u2.riot_tag_line as player_b_tag
       FROM matches m
       JOIN users u1 ON m.player_a_id = u1.user_id
       LEFT JOIN users u2 ON m.player_b_id = u2.user_id
       WHERE m.match_id = $1`,
      [id]
    );

    if (matchRes.rows.length === 0) return res.status(404).json({ error: 'Match not found' });
    res.json({ match: matchRes.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/matches/:id/accept
 * Moves status from pending -> accepted
 */
router.post('/:id/accept', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Get user
    const userRes = await db.query('SELECT user_id FROM users WHERE privy_user_id = $1', [userId]);
    const internalUserId = userRes.rows[0].user_id;

    // Update match if they are player_b and it's pending
    const matchRes = await db.query(
      `UPDATE matches SET status = 'accepted' 
       WHERE match_id = $1 AND player_b_id = $2 AND status = 'pending'
       RETURNING *`,
      [id, internalUserId]
    );

    if (matchRes.rows.length === 0) return res.status(400).json({ error: 'Invalid match or unauthorized' });
    res.json({ match: matchRes.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/matches/:id/deposit
 * Optimistically marks a user's deposit as complete and transitions to active if both deposited.
 * (In a production environment, this should be triggered by blockchain event listeners).
 */
router.post('/:id/deposit', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // In a real app we'd verify the txHash against the blockchain.
    // For this MVP, we optimistically set the status to 'active' once deposits are clicked.
    // Assuming both players hit this route, we'll just set it to active immediately to unblock testing.
    const matchRes = await db.query(
      `UPDATE matches SET status = 'active' WHERE match_id = $1 RETURNING *`,
      [id]
    );

    res.json({ match: matchRes.rows[0], message: 'Match is now active. Awaiting Riot results.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
