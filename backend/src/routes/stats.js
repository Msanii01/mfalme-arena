'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../db/client');

const router = express.Router();

/**
 * GET /api/stats/me
 * Returns the current user's match stats and recent games.
 */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const userRes = await db.query(
      'SELECT user_id FROM users WHERE privy_user_id = $1',
      [req.user.id]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userRes.rows[0].user_id;

    // Tic-Tac-Toe games the user participated in (finished only)
    const gamesRes = await db.query(
      `SELECT g.game_id, g.status, g.board, g.created_at,
              g.player_x_id, g.player_o_id,
              t.name as tournament_name, t.prize_pool
       FROM tictactoe_games g
       LEFT JOIN tournaments t ON g.tournament_id = t.tournament_id
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

    // Total earnings from completed tournaments won by this user
    const earningsRes = await db.query(
      `SELECT COALESCE(SUM(prize_pool), 0) AS total
       FROM tournaments
       WHERE winner_id = $1 AND status = 'completed'`,
      [userId]
    );
    const totalEarnings = parseFloat(earningsRes.rows[0].total);

    // Recent games formatted for the UI
    const recentGames = games.slice(0, 5).map(g => {
      const isX = g.player_x_id === userId;
      const mySymbol = isX ? 'X' : 'O';
      let result = 'draw';
      if (g.status === 'won_x') result = mySymbol === 'X' ? 'win' : 'loss';
      else if (g.status === 'won_o') result = mySymbol === 'O' ? 'win' : 'loss';

      return {
        game_id: g.game_id,
        tournament_name: g.tournament_name || 'Practice',
        prize_pool: g.prize_pool || 0,
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
