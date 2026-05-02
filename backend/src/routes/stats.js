'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../db/client');

const router = express.Router();

/**
 * GET /api/stats/me
 * Returns the current user's match stats and recent games.
 *
 * Money note: USDC has 6 decimals and round-trips through PG as a DECIMAL.
 * We must NOT pull these into JS numbers — `parseFloat` on "12.345678"
 * silently loses precision. Instead, we cast monetary aggregates to TEXT
 * in SQL and return the raw strings to the frontend, which formats them
 * (e.g. via ethers.formatUnits or BN math).
 */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const userRes = await db.query(
      'SELECT user_id FROM users WHERE privy_user_id = $1',
      [req.user.id]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userRes.rows[0].user_id;

    // Tic-Tac-Toe games the user participated in (finished only).
    // For monetary fields we cast to TEXT inside SQL so DECIMAL precision
    // is preserved across the wire.
    const gamesRes = await db.query(
      `SELECT g.game_id, g.status, g.board, g.created_at,
              g.player_x_id, g.player_o_id,
              t.name as tournament_name,
              t.prize_pool::TEXT as t_prize_pool,
              m.stake_amount::TEXT as m_stake_amount,
              (m.stake_amount * 2)::TEXT as m_payout,
              u1.wallet_address as p_a_wallet, u2.wallet_address as p_b_wallet
       FROM tictactoe_games g
       LEFT JOIN tournaments t ON g.tournament_id = t.tournament_id
       LEFT JOIN matches m ON g.match_id = m.match_id
       LEFT JOIN users u1 ON m.player_a_id = u1.user_id
       LEFT JOIN users u2 ON m.player_b_id = u2.user_id
       WHERE (g.player_x_id = $1 OR g.player_o_id = $1)
         AND g.status != 'active'
       ORDER BY g.created_at DESC
       LIMIT 10`,
      [userId]
    );

    const games = gamesRes.rows;
    const totalPlayed = games.length;

    const wins = games.filter(g =>
      (g.status === 'won_x' && g.player_x_id === userId) ||
      (g.status === 'won_o' && g.player_o_id === userId)
    ).length;

    const winRate = totalPlayed > 0 ? Math.round((wins / totalPlayed) * 100) : null;

    // Total earnings from completed tournaments AND matches won by this user.
    // Keep as TEXT — the frontend formats with full DECIMAL precision.
    const earningsRes = await db.query(
      `SELECT (
         (SELECT COALESCE(SUM(prize_pool), 0) FROM tournaments WHERE winner_id = $1 AND status = 'completed') +
         (SELECT COALESCE(SUM(stake_amount * 2), 0) FROM matches WHERE winner_id = $1 AND status = 'completed')
       )::TEXT AS total`,
      [userId]
    );
    const totalEarnings = earningsRes.rows[0].total; // string, e.g. "12.345678"

    // Recent games formatted for the UI. `prize` is a string for matches and
    // tournaments (already cast to TEXT above), or null for practice rows.
    const recentGames = games.slice(0, 5).map(g => {
      const isX = g.player_x_id === userId;
      const mySymbol = isX ? 'X' : 'O';
      let result = 'draw';
      if (g.status === 'won_x') result = mySymbol === 'X' ? 'win' : 'loss';
      else if (g.status === 'won_o') result = mySymbol === 'O' ? 'win' : 'loss';

      let name = 'Practice';
      let prize = null;

      if (g.tournament_name) {
        name = g.tournament_name;
        prize = g.t_prize_pool; // TEXT
      } else if (g.m_stake_amount !== null) {
        const oppWallet = isX ? g.p_b_wallet : g.p_a_wallet;
        name = oppWallet ? `${oppWallet.slice(0, 6)}...${oppWallet.slice(-4)}` : '1v1 Match';
        prize = g.m_payout; // TEXT — already (stake_amount * 2)::TEXT
      }

      return {
        game_id: g.game_id,
        tournament_name: name,
        prize_pool: prize,
        result,
        played_at: g.created_at,
      };
    });

    res.json({ stats: { totalPlayed, wins, winRate, totalEarnings, recentGames } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
