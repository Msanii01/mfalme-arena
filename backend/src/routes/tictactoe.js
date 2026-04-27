'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../db/client');
const { getIO } = require('../socket');
const { ethers } = require('ethers');

// Smart Contract Setup
const TOURNAMENT_ABI = [
  { inputs: [{ name: "tournamentId", type: "bytes32" }, { name: "winner", type: "address" }], name: "settle", outputs: [], type: "function" }
];
const ESCROW_ABI = [
  { inputs: [{ name: "matchId", type: "bytes32" }, { name: "winner", type: "address" }], name: "settle", outputs: [], type: "function" }
];

const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL || 'https://sepolia.base.org');
let oracleWallet, tournamentContract, escrowContract;

if (process.env.DEPLOYER_PRIVATE_KEY) {
  oracleWallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  if (process.env.TOURNAMENT_CONTRACT_ADDRESS) {
    tournamentContract = new ethers.Contract(process.env.TOURNAMENT_CONTRACT_ADDRESS, TOURNAMENT_ABI, oracleWallet);
  }
  if (process.env.ESCROW_CONTRACT_ADDRESS) {
    escrowContract = new ethers.Contract(process.env.ESCROW_CONTRACT_ADDRESS, ESCROW_ABI, oracleWallet);
  }
} else {
  console.warn('⚠️ DEPLOYER_PRIVATE_KEY is missing. Smart contract settlement will be disabled.');
}

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
 * Initializes a tic tac toe game for a tournament or match
 */
router.post('/init', requireAuth, async (req, res, next) => {
  try {
    const { tournamentId, matchId } = req.body;
    
    if (!tournamentId && !matchId) {
      return res.status(400).json({ error: 'Must provide tournamentId or matchId' });
    }

    let playerX, playerO;

    if (tournamentId) {
      const tRes = await db.query('SELECT player_a_id, player_b_id FROM tournaments WHERE tournament_id = $1', [tournamentId]);
      if (tRes.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });
      playerX = tRes.rows[0].player_a_id;
      playerO = tRes.rows[0].player_b_id;
    } else {
      const mRes = await db.query('SELECT challenger_id, challenged_id FROM matches WHERE match_id = $1', [matchId]);
      if (mRes.rows.length === 0) return res.status(404).json({ error: 'Match not found' });
      playerX = mRes.rows[0].challenger_id;
      playerO = mRes.rows[0].challenged_id;
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

    // Update DB
    const updateRes = await db.query(
      `UPDATE tictactoe_games SET board = $1, turn = $2, status = $3 WHERE game_id = $4 RETURNING *`,
      [newBoard, newTurn, newStatus, gameId]
    );
    game = updateRes.rows[0];

    // Broadcast over WebSocket
    const io = getIO();
    io.to(gameId).emit('game_update', game);

    // If game over, update DB immediately then attempt on-chain settlement async
    if (newStatus === 'won_x' || newStatus === 'won_o' || newStatus === 'draw') {
      const winnerId = newStatus === 'won_x' ? game.player_x_id : (newStatus === 'won_o' ? game.player_o_id : null);

      if (game.tournament_id) {
        // Immediately mark tournament as completed in DB — lobby will update on next poll
        await db.query(
          `UPDATE tournaments SET status = 'completed', winner_id = $1 WHERE tournament_id = $2`,
          [winnerId, game.tournament_id]
        );
        // Broadcast globally so lobby refreshes immediately via socket
        io.emit('settlement_success', { txHash: null });

        // Attempt on-chain settlement in the background (non-blocking)
        if (winnerId) {
          const winnerWalletRes = await db.query('SELECT wallet_address FROM users WHERE user_id = $1', [winnerId]);
          const winnerWallet = winnerWalletRes.rows[0]?.wallet_address;

          if (winnerWallet && tournamentContract) {
            const tRes = await db.query(
              "SELECT encode(contract_tournament_id, 'hex') AS contract_id FROM tournaments WHERE tournament_id = $1",
              [game.tournament_id]
            );
            const contractId = '0x' + tRes.rows[0].contract_id;
            console.log(`Settling tournament ${contractId} for winner ${winnerWallet}`);

            // Fire and forget — doesn't block the response
            tournamentContract.settle(contractId, winnerWallet)
              .then(tx => {
                io.to(gameId).emit('settlement_pending', { txHash: tx.hash });
                return tx.wait().then(() => {
                  db.query(
                    `UPDATE tournaments SET settle_tx = $1 WHERE tournament_id = $2`,
                    [tx.hash, game.tournament_id]
                  );
                  io.emit('settlement_success', { txHash: tx.hash });
                  console.log(`Tournament ${game.tournament_id} settled on-chain: ${tx.hash}`);
                });
              })
              .catch(e => console.error('Tournament on-chain settlement failed:', e));
          }
        }
      } else if (game.match_id) {
        // Match settlement — use hex-encoded contract ID
        const mRes = await db.query(
          "SELECT encode(contract_match_id, 'hex') AS contract_id FROM matches WHERE match_id = $1",
          [game.match_id]
        );
        const contractId = '0x' + mRes.rows[0].contract_id;

        console.log(`Settling match ${contractId} for winner ${winnerWallet}`);
        try {
          if (!escrowContract) throw new Error('Escrow contract not configured');
          const tx = await escrowContract.settle(contractId, winnerWallet);
          await tx.wait(); // wait for on-chain confirmation
          await db.query(
            `UPDATE matches SET status = 'completed', winner_id = $1, settle_tx = $2 WHERE match_id = $3`,
            [winnerId, tx.hash, game.match_id]
          );
          io.to(gameId).emit('settlement_success', { txHash: tx.hash });
        } catch (e) {
          console.error('Match settlement failed:', e);
        }
      }
    }

    res.json({ game });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
