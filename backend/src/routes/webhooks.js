'use strict';

const express = require('express');
const { ethers } = require('ethers');
const db = require('../db/client');
const escrowAbi = require('../constants/MatchEscrow.json').abi;

const router = express.Router();

/**
 * POST /api/webhooks/riot
 * Simulated Riot Games Webhook endpoint for MVP.
 * In production, Riot sends match completion data here.
 * 
 * Expected Body:
 * {
 *   "matchId": "UUID",
 *   "winnerPuuid": "the-riot-puuid-string"
 * }
 */
router.post('/riot', async (req, res, next) => {
  try {
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

    // 4. Trigger the smart contract settlement
    // Load admin oracle wallet
    const rpcUrl = process.env.BASE_RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const oracleWallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
    const escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS;

    if (!escrowAddress) {
      throw new Error('ESCROW_CONTRACT_ADDRESS not configured in environment');
    }

    const escrowContract = new ethers.Contract(escrowAddress, escrowAbi, oracleWallet);

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
    console.error('Webhook Settlement Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process webhook' });
  }
});

module.exports = router;
