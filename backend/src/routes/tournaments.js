'use strict';

const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const db = require('../db/client');

const router = express.Router();

// Middleware to check if user is admin via wallet address
const requireAdmin = async (req, res, next) => {
  try {
    const userRes = await db.query('SELECT wallet_address FROM users WHERE privy_user_id = $1', [req.user.id]);
    if (userRes.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized: Admin access required' });
    }
    
    const userWallet = userRes.rows[0].wallet_address;
    const adminWallet = process.env.ADMIN_WALLET_ADDRESS;
    
    if (!userWallet || !adminWallet || userWallet.toLowerCase() !== adminWallet.toLowerCase()) {
      return res.status(403).json({ error: 'Unauthorized: Admin access required' });
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/tournaments
 * List active/open tournaments.
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT t.*, 
              u1.riot_game_name as player_a_name, u1.riot_tag_line as player_a_tag,
              u2.riot_game_name as player_b_name, u2.riot_tag_line as player_b_tag
       FROM tournaments t
       LEFT JOIN users u1 ON t.player_a_id = u1.user_id
       LEFT JOIN users u2 ON t.player_b_id = u2.user_id
       ORDER BY t.created_at DESC`
    );
    res.json({ tournaments: result.rows });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tournaments
 * Create a new tournament (Admin only)
 */
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name, prizePool } = req.body;
    if (!name || !prizePool) {
      return res.status(400).json({ error: 'Missing name or prizePool' });
    }

    // Get admin internal ID
    const userRes = await db.query('SELECT user_id FROM users WHERE privy_user_id = $1', [req.user.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Admin profile not found' });
    const adminId = userRes.rows[0].user_id;

    // Generate contract_tournament_id (bytes32 hex string)
    const contractTournamentId = '0x' + crypto.randomBytes(32).toString('hex');

    const newTournament = await db.query(
      `INSERT INTO tournaments (created_by, name, prize_pool, status, contract_tournament_id)
       VALUES ($1, $2, $3, 'created', $4)
       RETURNING *`,
      [adminId, name, prizePool, contractTournamentId]
    );

    res.json({ tournament: newTournament.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tournaments/:id/fund
 * Mark tournament as funded (Admin only)
 */
router.post('/:id/fund', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { txHash } = req.body;

    const result = await db.query(
      `UPDATE tournaments SET status = 'open', fund_tx = $1 WHERE tournament_id = $2 RETURNING *`,
      [txHash, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });
    res.json({ tournament: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tournaments/:id/register
 * Register a player for an open tournament
 */
router.post('/:id/register', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Get player
    const userRes = await db.query('SELECT user_id, riot_puuid FROM users WHERE privy_user_id = $1', [userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User profile not found' });
    const player = userRes.rows[0];

    if (!player.riot_puuid) {
      return res.status(400).json({ error: 'You must link your Riot account to register' });
    }

    // Get tournament
    const tourneyRes = await db.query('SELECT * FROM tournaments WHERE tournament_id = $1', [id]);
    if (tourneyRes.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });
    const tournament = tourneyRes.rows[0];

    if (tournament.status !== 'open') {
      return res.status(400).json({ error: 'Tournament is not open for registration' });
    }
    if (tournament.player_a_id === player.user_id || tournament.player_b_id === player.user_id) {
      return res.status(400).json({ error: 'You are already registered' });
    }

    // Assign player
    let updateQuery;
    let updateParams;

    if (!tournament.player_a_id) {
      updateQuery = `UPDATE tournaments SET player_a_id = $1, player_a_puuid = $2 WHERE tournament_id = $3 RETURNING *`;
      updateParams = [player.user_id, player.riot_puuid, id];
    } else if (!tournament.player_b_id) {
      // 2nd player sets status to full
      updateQuery = `UPDATE tournaments SET player_b_id = $1, player_b_puuid = $2, status = 'full' WHERE tournament_id = $3 RETURNING *`;
      updateParams = [player.user_id, player.riot_puuid, id];
    } else {
      return res.status(400).json({ error: 'Tournament is full' });
    }

    const result = await db.query(updateQuery, updateParams);
    res.json({ tournament: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
