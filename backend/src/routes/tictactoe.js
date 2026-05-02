'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../db/client');
const { getIO } = require('../socket');
const {
  getEscrowContract,
  getTournamentContract,
} = require('../services/oracle');

const router = express.Router();

const checkWin = (board) => {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
    [0, 4, 8], [2, 4, 6]             // diagonals
  ];
  for (let i = 0; i < lines.length; i++) {
    const [a, b, c] = lines[i];
    if (board[a] !== '-' && board[a] === board[b] && board[a] === board[c]) {
      return board[a]; // 'X' or 'O'
    }
  }
  if (!board.includes('-')) return 'draw';
  return null;
};

/**
 * POST /api/tictactoe/init
 * Initializes a tic tac toe game for a tournament or match.
 *
 * Guard: a TTT game may only be created when the underlying match (or
 * tournament's match-equivalent) is `active` and both players have funded
 * their deposits. Without this guard, a settlement could fire before the
 * escrow holds the stake — letting the contract revert / pay nothing.
 */
router.post('/init', requireAuth, async (req, res, next) => {
  try {
    const { tournamentId, matchId } = req.body;

    if (!tournamentId && !matchId) {
      return res.status(400).json({ error: 'Must provide tournamentId or matchId' });
    }

    let playerX, playerO;

    if (tournamentId) {
      const tRes = await db.query(
        `SELECT player_a_id, player_b_id, status FROM tournaments WHERE tournament_id = $1`,
        [tournamentId]
      );
      if (tRes.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });
      // For tournaments, allow `full` (registration done) or `active` to bootstrap
      // the TTT board. The tournament has no per-player deposit columns — the
      // host pre-funds the prize pool via fundTournament.
      const t = tRes.rows[0];
      if (t.status !== 'full' && t.status !== 'active') {
        return res.status(400).json({ error: `Tournament not ready (status='${t.status}')` });
      }
      playerX = t.player_a_id;
      playerO = t.player_b_id;
    } else {
      // Match-mode: require status='active' AND both deposits in.
      // FIX: previous code referenced nonexistent columns challenger_id/challenged_id.
      const mRes = await db.query(
        `SELECT player_a_id, player_b_id, status, player_a_deposited, player_b_deposited
           FROM matches WHERE match_id = $1`,
        [matchId]
      );
      if (mRes.rows.length === 0) return res.status(404).json({ error: 'Match not found' });
      const m = mRes.rows[0];
      if (m.status !== 'active') {
        return res.status(400).json({ error: `Match not active (status='${m.status}')` });
      }
      if (!m.player_a_deposited || !m.player_b_deposited) {
        return res.status(400).json({ error: 'Both players must deposit before the game starts' });
      }
      playerX = m.player_a_id;
      playerO = m.player_b_id;
    }

    if (!playerX || !playerO) {
      return res.status(400).json({ error: 'Match/Tournament is not full yet' });
    }

    // Check if game already exists
    let existingGame;
    if (tournamentId) {
      const gRes = await db.query('SELECT * FROM tictactoe_games WHERE tournament_id = $1', [tournamentId]);
      if (gRes.rows.length > 0) existingGame = gRes.rows[0];
    } else {
      const gRes = await db.query('SELECT * FROM tictactoe_games WHERE match_id = $1', [matchId]);
      if (gRes.rows.length > 0) existingGame = gRes.rows[0];
    }

    if (existingGame) {
      return res.json({ game: existingGame });
    }

    const newGame = await db.query(
      `INSERT INTO tictactoe_games (tournament_id, match_id, player_x_id, player_o_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tournamentId || null, matchId || null, playerX, playerO]
    );

    res.json({ game: newGame.rows[0] });
  } catch (error) {
    next(error);
  }
});


/**
 * GET /api/tictactoe/:gameId
 */
router.get('/:gameId', requireAuth, async (req, res, next) => {
  try {
    const { gameId } = req.params;
    const result = await db.query(`SELECT * FROM tictactoe_games WHERE game_id = $1`, [gameId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
    res.json({ game: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tictactoe/:gameId/move
 *
 * Guards:
 *   - The underlying match must be `active` (or the tournament must be
 *     `full`/`active`) before a move is recorded — otherwise we'd let the
 *     game progress on stake-less data.
 *   - When the game ends, we attempt an atomic UPDATE that flips the match
 *     row to `completed` only if it's currently `active`. The oracle
 *     settle/cancel is only fired when that UPDATE actually wins (1 row
 *     affected), so concurrent move handlers can't double-settle.
 */
router.post('/:gameId/move', requireAuth, async (req, res, next) => {
  try {
    const { gameId } = req.params;
    const { index } = req.body; // 0-8

    // Get user id
    const userRes = await db.query('SELECT user_id, wallet_address FROM users WHERE privy_user_id = $1', [req.user.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userRes.rows[0].user_id;

    // Get game
    const gameRes = await db.query('SELECT * FROM tictactoe_games WHERE game_id = $1', [gameId]);
    if (gameRes.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
    let game = gameRes.rows[0];

    if (game.status !== 'active') return res.status(400).json({ error: 'Game over' });
    if (index < 0 || index > 8) return res.status(400).json({ error: 'Invalid move' });

    // Verify the underlying funded entity is in a playable state.
    if (game.match_id) {
      const mRes = await db.query(`SELECT status FROM matches WHERE match_id = $1`, [game.match_id]);
      if (mRes.rows.length === 0 || mRes.rows[0].status !== 'active') {
        return res.status(400).json({ error: 'Match is not active' });
      }
    } else if (game.tournament_id) {
      const tRes = await db.query(`SELECT status FROM tournaments WHERE tournament_id = $1`, [game.tournament_id]);
      if (tRes.rows.length === 0) return res.status(400).json({ error: 'Tournament not found' });
      const tStatus = tRes.rows[0].status;
      if (tStatus !== 'full' && tStatus !== 'active') {
        return res.status(400).json({ error: `Tournament not playable (status='${tStatus}')` });
      }
    }

    // Determine player's symbol
    let playerSymbol;
    if (game.player_x_id === userId) playerSymbol = 'X';
    else if (game.player_o_id === userId) playerSymbol = 'O';
    else return res.status(403).json({ error: 'Not a player in this game' });

    if (game.turn !== playerSymbol) return res.status(400).json({ error: 'Not your turn' });

    // Parse board
    let boardArr = game.board.split('');
    if (boardArr[index] !== '-') return res.status(400).json({ error: 'Cell already taken' });

    // Make move
    boardArr[index] = playerSymbol;
    const newBoard = boardArr.join('');
    const newTurn = playerSymbol === 'X' ? 'O' : 'X';

    let newStatus = 'active';
    const winResult = checkWin(newBoard);

    if (winResult === 'X') newStatus = 'won_x';
    else if (winResult === 'O') newStatus = 'won_o';
    else if (winResult === 'draw') newStatus = 'draw';

    // Update game row
    const updateRes = await db.query(
      `UPDATE tictactoe_games SET board = $1, turn = $2, status = $3 WHERE game_id = $4 RETURNING *`,
      [newBoard, newTurn, newStatus, gameId]
    );
    game = updateRes.rows[0];

    // Broadcast over WebSocket
    const io = getIO();
    io.to(gameId).emit('game_update', game);

    // If game over, attempt to flip the match/tournament to `completed` —
    // but ONLY the first writer (whose UPDATE returns a row) gets to fire
    // on-chain settlement. This prevents two concurrent move handlers from
    // racing into double-settle.
    if (newStatus === 'won_x' || newStatus === 'won_o' || newStatus === 'draw') {
      const winnerId = newStatus === 'won_x' ? game.player_x_id : (newStatus === 'won_o' ? game.player_o_id : null);

      if (game.tournament_id) {
        const claimed = await db.query(
          `UPDATE tournaments
              SET status = 'completed',
                  winner_id = $1,
                  completed_at = NOW()
            WHERE tournament_id = $2 AND status IN ('full', 'active')
            RETURNING *`,
          [winnerId, game.tournament_id]
        );

        if (claimed.rows.length === 1) {
          io.emit('settlement_success', { txHash: null });

          if (winnerId) {
            const winnerWalletRes = await db.query('SELECT wallet_address FROM users WHERE user_id = $1', [winnerId]);
            const winnerWallet = winnerWalletRes.rows[0]?.wallet_address;

            const tournamentContract = getTournamentContract();
            if (winnerWallet && tournamentContract) {
              const tRes = await db.query(
                "SELECT encode(contract_tournament_id, 'hex') AS contract_id FROM tournaments WHERE tournament_id = $1",
                [game.tournament_id]
              );
              const contractId = '0x' + tRes.rows[0].contract_id;
              console.log(`Settling tournament ${contractId} for winner ${winnerWallet}`);

              tournamentContract.settle(contractId, winnerWallet)
                .then(tx => {
                  io.to(gameId).emit('settlement_pending', { txHash: tx.hash });
                  return tx.wait().then(() => {
                    db.query(
                      `UPDATE tournaments SET settlement_tx = $1 WHERE tournament_id = $2`,
                      [tx.hash, game.tournament_id]
                    );
                    io.emit('settlement_success', { txHash: tx.hash });
                    console.log(`Tournament ${game.tournament_id} settled on-chain: ${tx.hash}`);
                  });
                })
                .catch(e => console.error('Tournament on-chain settlement failed:', e));
            }
          }
        }
      } else if (game.match_id) {
        // Atomic claim: only the first thread to flip status='active' -> 'completed' fires settle.
        const claimed = await db.query(
          `UPDATE matches
              SET status = 'completed',
                  winner_id = $1,
                  completed_at = NOW()
            WHERE match_id = $2 AND status = 'active'
            RETURNING *`,
          [winnerId, game.match_id]
        );

        if (claimed.rows.length === 1) {
          io.emit('settlement_success', { txHash: null });

          const escrowContract = getEscrowContract();
          const mRes = await db.query(
            "SELECT encode(escrow_match_id, 'hex') AS contract_id FROM matches WHERE match_id = $1",
            [game.match_id]
          );
          const contractId = '0x' + mRes.rows[0].contract_id;

          if (winnerId) {
            const winnerWalletRes = await db.query('SELECT wallet_address FROM users WHERE user_id = $1', [winnerId]);
            const winnerWallet = winnerWalletRes.rows[0]?.wallet_address;

            if (winnerWallet) {
              console.log(`Settling match ${contractId} for winner ${winnerWallet}`);

              if (escrowContract) {
                escrowContract.settle(contractId, winnerWallet)
                  .then(tx => {
                    io.to(gameId).emit('settlement_pending', { txHash: tx.hash });
                    return tx.wait().then(() => {
                      db.query(
                        `UPDATE matches SET settlement_tx = $1 WHERE match_id = $2`,
                        [tx.hash, game.match_id]
                      );
                      io.emit('settlement_success', { txHash: tx.hash });
                      console.log(`Match ${game.match_id} settled on-chain: ${tx.hash}`);
                    });
                  })
                  .catch(e => console.error('Match on-chain settlement failed:', e));
              } else {
                console.warn('Match ended but escrow contract not configured');
              }
            }
          } else if (newStatus === 'draw') {
            // Draw -> cancel the match to refund both players
            if (escrowContract) {
              escrowContract.cancel(contractId)
                .then(tx => {
                  io.to(gameId).emit('settlement_pending', { txHash: tx.hash });
                  return tx.wait().then(() => {
                    db.query(`UPDATE matches SET settlement_tx = $1 WHERE match_id = $2`, [tx.hash, game.match_id]);
                    io.emit('settlement_success', { txHash: tx.hash });
                    console.log(`Match ${game.match_id} draw refunded on-chain: ${tx.hash}`);
                  });
                })
                .catch(e => console.error('Match draw refund failed:', e));
            }
          }
        }
      }
    }

    res.json({ game });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
