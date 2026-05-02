'use strict';

const express = require('express');
const crypto = require('crypto');
const { ethers } = require('ethers');
const { requireAuth } = require('../middleware/auth');
const db = require('../db/client');
const {
  getProvider,
  getTournamentContract,
  TOURNAMENT_ABI,
} = require('../services/oracle');

const router = express.Router();

// Lazy handle to the oracle-signed TournamentPool contract (used for `register`).
function tournamentContract() {
  return getTournamentContract();
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
 * Mark tournament as funded (Host).
 *
 * Verifies:
 *   1. Caller is the tournament's `created_by`.
 *   2. The supplied `txHash` corresponds to a successful tx whose `to` is the
 *      configured TournamentPool contract.
 *   3. The receipt contains a `TournamentFunded(bytes32 indexed tournamentId, ...)`
 *      log whose tournamentId matches this row's contract_tournament_id.
 *
 * Without these checks, any auth'd user could move any tournament to `open`
 * by passing any string as txHash.
 */
router.post('/:id/fund', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { txHash } = req.body;

    if (!txHash || typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return res.status(400).json({ error: 'Invalid or missing txHash' });
    }

    // (a) Fetch tournament + verify caller is the host
    const userRes = await db.query('SELECT user_id FROM users WHERE privy_user_id = $1', [req.user.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const callerInternalId = userRes.rows[0].user_id;

    const tRes = await db.query(
      `SELECT *, encode(contract_tournament_id, 'hex') as contract_hex
       FROM tournaments WHERE tournament_id = $1`,
      [id]
    );
    if (tRes.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });
    const tournament = tRes.rows[0];

    if (tournament.created_by !== callerInternalId) {
      return res.status(403).json({ error: 'Only the tournament host can fund' });
    }

    if (tournament.status !== 'created') {
      return res.status(400).json({ error: `Tournament cannot be funded from status='${tournament.status}'` });
    }

    const expectedContract = process.env.TOURNAMENT_CONTRACT_ADDRESS;
    if (!expectedContract) {
      return res.status(500).json({ error: 'Server misconfigured: TOURNAMENT_CONTRACT_ADDRESS not set' });
    }

    // (b) Verify the on-chain tx
    const provider = getProvider();
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return res.status(400).json({ error: 'Transaction receipt not found (not mined yet?)' });
    }
    if (receipt.status !== 1) {
      return res.status(400).json({ error: 'Transaction failed on-chain' });
    }
    if (!receipt.to || receipt.to.toLowerCase() !== expectedContract.toLowerCase()) {
      return res.status(400).json({ error: 'Transaction was not sent to the TournamentPool contract' });
    }

    // Decode logs to find TournamentFunded(tournamentId, amount)
    const iface = new ethers.Interface(TOURNAMENT_ABI);
    const expectedTopic = ethers.id('TournamentFunded(bytes32,uint256)');
    const expectedTournamentIdHex = '0x' + tournament.contract_hex;

    let foundFundedEvent = false;
    for (const log of receipt.logs) {
      if (!log.topics || log.topics.length === 0) continue;
      if (log.address.toLowerCase() !== expectedContract.toLowerCase()) continue;
      if (log.topics[0] !== expectedTopic) continue;
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (!parsed) continue;
        const emittedId = parsed.args.tournamentId;
        if (typeof emittedId === 'string' && emittedId.toLowerCase() === expectedTournamentIdHex.toLowerCase()) {
          foundFundedEvent = true;
          break;
        }
      } catch (_e) {
        // Not the event we want — keep scanning.
      }
    }

    if (!foundFundedEvent) {
      return res.status(400).json({ error: 'TournamentFunded event for this tournament not found in transaction' });
    }

    // (c) Persist transition. Guard `status='created'` to keep this idempotent
    // even if two clients race the same valid txHash.
    const result = await db.query(
      `UPDATE tournaments
       SET status = 'open', fund_tx = $1
       WHERE tournament_id = $2 AND status = 'created'
       RETURNING *, encode(contract_tournament_id, 'hex') as contract_hex`,
      [txHash, id]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Tournament status changed concurrently' });
    }

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
 * Register a player for an open tournament.
 *
 * Implementation note: previously this used a SELECT-then-conditional-UPDATE
 * pattern, which is non-atomic — two concurrent requests could both observe
 * an empty slot and both write. We collapse this into a single UPDATE that
 * fills only an empty slot, and rely on RETURNING to determine which slot
 * (if any) the caller actually claimed.
 */
router.post('/:id/register', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const userRes = await db.query(
      'SELECT user_id, riot_puuid, wallet_address FROM users WHERE privy_user_id = $1',
      [userId]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User profile not found' });
    const player = userRes.rows[0];

    // Riot linking is no longer required for tournaments (Tic Tac Toe MVP)

    // Atomic claim: take slot A if empty; else take slot B if empty AND not the
    // same player as A; flip status to 'full' iff slot B is being filled.
    // The WHERE clause guarantees we only touch rows that actually have
    // capacity for this player.
    const updateRes = await db.query(
      `UPDATE tournaments
         SET player_a_id = COALESCE(player_a_id, $1),
             player_b_id = CASE
               WHEN player_a_id IS NOT NULL AND player_a_id <> $1 AND player_b_id IS NULL
                 THEN $1
               ELSE player_b_id
             END,
             status = CASE
               WHEN player_a_id IS NOT NULL AND player_a_id <> $1 AND player_b_id IS NULL
                 THEN 'full'::tournament_status
               ELSE status
             END
       WHERE tournament_id = $2
         AND status = 'open'
         AND (
              player_a_id IS NULL
              OR (player_b_id IS NULL AND player_a_id <> $1)
         )
       RETURNING *, encode(contract_tournament_id, 'hex') as contract_hex`,
      [player.user_id, id]
    );

    if (updateRes.rows.length === 0) {
      // Either the tournament doesn't exist, isn't 'open', is full, or this
      // user is already registered. Disambiguate with a follow-up read.
      const existing = await db.query(
        `SELECT status, player_a_id, player_b_id FROM tournaments WHERE tournament_id = $1`,
        [id]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Tournament not found' });
      }
      const t = existing.rows[0];
      if (t.player_a_id === player.user_id || t.player_b_id === player.user_id) {
        return res.status(400).json({ error: 'You are already registered' });
      }
      if (t.status !== 'open') {
        return res.status(400).json({ error: `Tournament is not open (status='${t.status}')` });
      }
      return res.status(400).json({ error: 'Tournament is full' });
    }

    const row = updateRes.rows[0];
    row.contract_tournament_id = '0x' + row.contract_hex;
    delete row.contract_hex;

    // Register player on-chain (fire & forget — non-blocking)
    const tc = tournamentContract();
    if (tc && player.wallet_address) {
      const contractId = row.contract_tournament_id;
      tc.register(contractId, player.wallet_address)
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
