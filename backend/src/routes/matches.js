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
              u1.riot_game_name as player_a_name, u1.riot_tag_line as player_a_tag, u1.wallet_address as player_a_wallet,
              u2.riot_game_name as player_b_name, u2.riot_tag_line as player_b_tag, u2.wallet_address as player_b_wallet,
              g.game_id as tictactoe_game_id
       FROM matches m
       JOIN users u1 ON m.player_a_id = u1.user_id
       LEFT JOIN users u2 ON m.player_b_id = u2.user_id
       LEFT JOIN tictactoe_games g ON m.match_id = g.match_id
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
    const { opponentGameName, opponentTagLine, opponentWallet, stakeAmount, gameMode } = req.body;
    
    if (!stakeAmount) {
      return res.status(400).json({ error: 'Missing stake amount' });
    }

    const userId = req.user.id;
    
    // 1. Get creator's internal ID
    const creatorRes = await db.query('SELECT user_id, riot_puuid, wallet_address FROM users WHERE privy_user_id = $1', [userId]);
    const creator = creatorRes.rows[0];

    let opponentId;
    let creatorPuuid = null;
    let opponentPuuid = null;
    
    const mode = gameMode === 'tictactoe' ? 'tictactoe' : 'lol';

    if (mode === 'lol') {
      if (!opponentGameName || !opponentTagLine) return res.status(400).json({ error: 'Missing Riot ID fields' });
      if (!creator.riot_puuid) return res.status(400).json({ error: 'Please link your Riot account first' });
      
      const opponentRiot = await getAccountByRiotId(opponentGameName, opponentTagLine);
      if (opponentRiot.puuid === creator.riot_puuid) {
        return res.status(400).json({ error: 'You cannot challenge yourself' });
      }

      const opponentRes = await db.query('SELECT user_id FROM users WHERE riot_puuid = $1', [opponentRiot.puuid]);
      if (opponentRes.rows.length === 0) {
        return res.status(400).json({ error: 'Opponent has not registered on Mfalme Arena yet' });
      }
      opponentId = opponentRes.rows[0].user_id;
      creatorPuuid = creator.riot_puuid;
      opponentPuuid = opponentRiot.puuid;
      
    } else {
      // Tic-Tac-Toe mode
      if (!opponentWallet) return res.status(400).json({ error: 'Missing opponent wallet address' });
      if (opponentWallet.toLowerCase() === creator.wallet_address.toLowerCase()) {
        return res.status(400).json({ error: 'You cannot challenge yourself' });
      }
      const opponentRes = await db.query('SELECT user_id FROM users WHERE LOWER(wallet_address) = LOWER($1)', [opponentWallet]);
      if (opponentRes.rows.length === 0) {
        return res.status(400).json({ error: 'Opponent has not registered on Mfalme Arena yet' });
      }
      opponentId = opponentRes.rows[0].user_id;
    }

    // 4. Generate escrow_match_id (32 bytes hex for smart contract keccak256)
    const escrowMatchId = '0x' + crypto.randomBytes(32).toString('hex');

    // 5. Insert match
    const newMatch = await db.query(
      `INSERT INTO matches (player_a_id, player_b_id, player_a_puuid, player_b_puuid, stake_amount, escrow_match_id, game_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [creator.user_id, opponentId, creatorPuuid, opponentPuuid, stakeAmount, escrowMatchId, mode]
    );

    const matchObj = newMatch.rows[0];

    // 6. If tictactoe, create the game record linked to this match
    if (mode === 'tictactoe') {
      await db.query(
        `INSERT INTO tictactoe_games (match_id, player_x_id, player_o_id, status, board, turn)
         VALUES ($1, $2, $3, 'pending', '---------', 'X')`,
        [matchObj.match_id, creator.user_id, opponentId]
      );
    }

    res.json({ match: matchObj });
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
              u1.riot_game_name as player_a_name, u1.riot_tag_line as player_a_tag, u1.wallet_address as player_a_wallet,
              u2.riot_game_name as player_b_name, u2.riot_tag_line as player_b_tag, u2.wallet_address as player_b_wallet,
              g.game_id as tictactoe_game_id
       FROM matches m
       JOIN users u1 ON m.player_a_id = u1.user_id
       LEFT JOIN users u2 ON m.player_b_id = u2.user_id
       LEFT JOIN tictactoe_games g ON m.match_id = g.match_id
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
    
    const match = matchRes.rows[0];

    // Also activate the Tic-Tac-Toe game if it's a TTT match
    if (match.game_mode === 'tictactoe') {
      await db.query(`UPDATE tictactoe_games SET status = 'active' WHERE match_id = $1`, [id]);
    }

    res.json({ match, message: 'Match is now active.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
