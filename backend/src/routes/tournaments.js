'use strict';

const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const db = require('../db/client');

const router = express.Router();

// requireAdmin removed to allow decentralized hosts

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
    const tournaments = result.rows.map(t => {
      if (Buffer.isBuffer(t.contract_tournament_id)) {
        t.contract_tournament_id = '0x' + t.contract_tournament_id.toString('hex');
      }
      return t;
    });
    res.json({ tournaments });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tournaments
 * Create a new tournament (Host)
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, prizePool } = req.body;
    if (!name || !prizePool) {
      return res.status(400).json({ error: 'Missing name or prizePool' });
    }

    // Get host internal ID
    const userRes = await db.query('SELECT user_id FROM users WHERE privy_user_id = $1', [req.user.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Host profile not found' });
    const hostId = userRes.rows[0].user_id;

    // Generate contract_tournament_id for Postgres BYTEA (hex string)
    const randomHex = crypto.randomBytes(32).toString('hex');
    const contractTournamentId = '\\x' + randomHex;

    const newTournament = await db.query(
      `INSERT INTO tournaments (created_by, name, prize_pool, status, contract_tournament_id)
       VALUES ($1, $2, $3, 'created', $4)
       RETURNING *`,
      [hostId, name, prizePool, contractTournamentId]
    );
    const row = newTournament.rows[0];
    if (Buffer.isBuffer(row.contract_tournament_id)) {
      row.contract_tournament_id = '0x' + row.contract_tournament_id.toString('hex');
    }

    res.json({ tournament: row });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tournaments/:id/fund
 * Mark tournament as funded (Host)
 */
router.post('/:id/fund', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { txHash } = req.body;

    const result = await db.query(
      `UPDATE tournaments SET status = 'open', fund_tx = $1 WHERE tournament_id = $2 RETURNING *`,
      [txHash, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });
    const row = result.rows[0];
    if (Buffer.isBuffer(row.contract_tournament_id)) {
      row.contract_tournament_id = '0x' + row.contract_tournament_id.toString('hex');
    }
    res.json({ tournament: row });
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

    // Riot linking is no longer required for tournaments (Tic Tac Toe MVP)

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
      updateQuery = `UPDATE tournaments SET player_a_id = $1 WHERE tournament_id = $2 RETURNING *`;
      updateParams = [player.user_id, id];
    } else if (!tournament.player_b_id) {
      // 2nd player sets status to full
      updateQuery = `UPDATE tournaments SET player_b_id = $1, status = 'full' WHERE tournament_id = $2 RETURNING *`;
      updateParams = [player.user_id, id];
    } else {
      return res.status(400).json({ error: 'Tournament is full' });
    }

    const result = await db.query(updateQuery, updateParams);
    const row = result.rows[0];
    if (Buffer.isBuffer(row.contract_tournament_id)) {
      row.contract_tournament_id = '0x' + row.contract_tournament_id.toString('hex');
    }
    res.json({ tournament: row });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
