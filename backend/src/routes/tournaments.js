'use strict';

const express = require('express');
const crypto = require('crypto');
const { ethers } = require('ethers');
const { requireAuth } = require('../middleware/auth');
const db = require('../db/client');

const router = express.Router();

// Oracle setup for on-chain registration
const TOURNAMENT_ABI = [
  { inputs: [{ name: 'tournamentId', type: 'bytes32' }, { name: 'player', type: 'address' }], name: 'register', outputs: [], type: 'function' }
];
const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL || 'https://sepolia.base.org');
const oracleKey = process.env.ADMIN_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
let tournamentContract = null;
if (oracleKey && process.env.TOURNAMENT_CONTRACT_ADDRESS) {
  const oracleWallet = new ethers.Wallet(oracleKey, provider);
  tournamentContract = new ethers.Contract(process.env.TOURNAMENT_CONTRACT_ADDRESS, TOURNAMENT_ABI, oracleWallet);
}

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
       WHERE t.status != 'created'
       ORDER BY t.created_at DESC`
    );
    const tournaments = result.rows.map(t => {
      // Postgres encode(..., 'hex') would be better, but since it's a SELECT *, 
      // let's handle the object if pg already parsed it into a Buffer or JSON-like object
      if (t.contract_tournament_id) {
        if (Buffer.isBuffer(t.contract_tournament_id)) {
          t.contract_tournament_id = '0x' + t.contract_tournament_id.toString('hex');
        } else if (t.contract_tournament_id.type === 'Buffer' && Array.isArray(t.contract_tournament_id.data)) {
          t.contract_tournament_id = '0x' + Buffer.from(t.contract_tournament_id.data).toString('hex');
        } else if (typeof t.contract_tournament_id === 'string' && !t.contract_tournament_id.startsWith('0x')) {
          t.contract_tournament_id = '0x' + t.contract_tournament_id;
        }
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
       RETURNING *, encode(contract_tournament_id, 'hex') as contract_hex`,
      [hostId, name, prizePool, contractTournamentId]
    );
    const row = newTournament.rows[0];
    row.contract_tournament_id = '0x' + row.contract_hex;
    delete row.contract_hex;

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
      `UPDATE tournaments SET status = 'open', fund_tx = $1 WHERE tournament_id = $2 RETURNING *, encode(contract_tournament_id, 'hex') as contract_hex`,
      [txHash, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });
    const row = result.rows[0];
    row.contract_tournament_id = '0x' + row.contract_hex;
    delete row.contract_hex;
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
    const userRes = await db.query('SELECT user_id, riot_puuid, wallet_address FROM users WHERE privy_user_id = $1', [userId]);
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
      updateQuery = `UPDATE tournaments SET player_a_id = $1 WHERE tournament_id = $2 RETURNING *, encode(contract_tournament_id, 'hex') as contract_hex`;
      updateParams = [player.user_id, id];
    } else if (!tournament.player_b_id) {
      // 2nd player sets status to full
      updateQuery = `UPDATE tournaments SET player_b_id = $1, status = 'full' WHERE tournament_id = $2 RETURNING *, encode(contract_tournament_id, 'hex') as contract_hex`;
      updateParams = [player.user_id, id];
    } else {
      return res.status(400).json({ error: 'Tournament is full' });
    }

    const result = await db.query(updateQuery, updateParams);
    const row = result.rows[0];
    row.contract_tournament_id = '0x' + row.contract_hex;
    delete row.contract_hex;

    // Register player on-chain (fire & forget — non-blocking)
    if (tournamentContract && player.wallet_address) {
      const contractId = row.contract_tournament_id;
      tournamentContract.register(contractId, player.wallet_address)
        .then(tx => {
          console.log(`On-chain register tx: ${tx.hash} for player ${player.wallet_address}`);
          return tx.wait();
        })
        .then(() => console.log(`Player ${player.wallet_address} registered on-chain for tournament ${id}`))
        .catch(err => console.error('On-chain register failed (non-fatal):', err.message));
    } else {
      console.warn('Skipping on-chain register: oracle not configured or player has no wallet_address');
    }

    res.json({ tournament: row });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
