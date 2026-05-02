'use strict';

const crypto = require('crypto');
const express = require('express');
const db = require('../db/client');
const { getEscrowContract } = require('../services/oracle');

const router = express.Router();

function timingSafeEqualStr(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * POST /api/webhooks/riot
 * Internal-only settlement endpoint. Callers must present
 * X-Internal-Auth matching WEBHOOK_SECRET. The endpoint fails
 * closed if WEBHOOK_SECRET is not configured.
 *
 * Expected Body:
 * {
 *   "matchId": "UUID",
 *   "winnerPuuid": "the-riot-puuid-string"
 * }
 */
router.post('/riot', async (req, res, next) => {
  try {
    const expected = process.env.WEBHOOK_SECRET;
    if (!expected) {
      return res.status(503).json({ error: 'Webhook disabled' });
    }
    const provided = req.get('X-Internal-Auth');
    if (!provided || !timingSafeEqualStr(provided, expected)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { matchId, winnerPuuid } = req.body;
    
    if (!matchId || !winnerPuuid) {
      return res.status(400).json({ error: 'Missing matchId or winnerPuuid' });
    }

    // 1. Verify the match exists and is active
    const matchRes = await db.query(`SELECT * FROM matches WHERE match_id = $1 AND status = 'active'`, [matchId]);
    if (matchRes.rows.length === 0) {
      return res.status(404).json({ error: 'Active match not found' });
    }
    const match = matchRes.rows[0];

    // 2. Validate winner
    if (winnerPuuid !== match.player_a_puuid && winnerPuuid !== match.player_b_puuid) {
      return res.status(400).json({ error: 'Winner PUUID does not belong to either player in this match' });
    }

    // 3. Find the winner's wallet address
    const winnerRes = await db.query(`SELECT wallet_address, user_id FROM users WHERE riot_puuid = $1`, [winnerPuuid]);
    if (winnerRes.rows.length === 0) {
      return res.status(500).json({ error: 'Winner user record not found' });
    }
    const winnerWallet = winnerRes.rows[0].wallet_address;
    const winnerUserId = winnerRes.rows[0].user_id;

    // 4. Trigger the smart contract settlement using the shared oracle wallet
    // (services/oracle.js — single source of truth for the on-chain signer).
    const escrowContract = getEscrowContract();
    if (!escrowContract) {
      return res.status(503).json({ error: 'Oracle settlement disabled (ORACLE_PRIVATE_KEY or ESCROW_CONTRACT_ADDRESS missing)' });
    }

    console.log(`⚖️ Settling match ${matchId} for winner ${winnerWallet}`);

    // The escrow_match_id is a hex string (bytes32) we stored in the DB
    const tx = await escrowContract.settle(match.escrow_match_id, winnerWallet);
    const receipt = await tx.wait();

    // 5. Update database
    await db.query(
      `UPDATE matches 
       SET status = 'completed', winner_id = $1, winner_puuid = $2, settlement_tx = $3, completed_at = NOW()
       WHERE match_id = $4`,
      [winnerUserId, winnerPuuid, receipt.hash, matchId]
    );

    res.json({ message: 'Match successfully settled on-chain', txHash: receipt.hash });
  } catch (error) {
    // Don't leak error.message (which can include node stack details / RPC
    // internals). Hand off to the global error handler, which logs the full
    // error server-side and returns a redacted response in production.
    next(error);
  }
});

module.exports = router;
