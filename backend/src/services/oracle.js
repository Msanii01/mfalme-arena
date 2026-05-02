'use strict';

/**
 * Oracle service — single source of truth for the backend's on-chain
 * settlement signer (the "oracle wallet") and contract handles.
 *
 * Why: previously, individual route files each instantiated their own
 * ethers.Wallet using a mix of ADMIN_PRIVATE_KEY / DEPLOYER_PRIVATE_KEY
 * fallbacks. That made the trust boundary fuzzy and made it possible to
 * accidentally sign settlements with the deployer key.
 *
 * Now: this module requires ORACLE_PRIVATE_KEY explicitly. There is NO
 * fallback to the deployer key. In production a missing ORACLE_PRIVATE_KEY
 * is fatal (throws at module load); in dev/test the contract handles
 * remain null so callers can degrade gracefully.
 */

const { ethers } = require('ethers');

const ESCROW_ABI = require('../constants/MatchEscrow.json').abi;
const TOURNAMENT_ABI = require('../constants/TournamentPool.json').abi;

const RPC_URL = process.env.BASE_RPC_URL || 'https://sepolia.base.org';

let _provider = null;
let _wallet = null;
let _escrow = null;
let _tournament = null;
let _initialized = false;

function getProvider() {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(RPC_URL);
  }
  return _provider;
}

function _init() {
  if (_initialized) return;
  _initialized = true;

  const key = process.env.ORACLE_PRIVATE_KEY;
  if (!key) {
    const msg = 'ORACLE_PRIVATE_KEY is not set — oracle settlement disabled.';
    if (process.env.NODE_ENV === 'production') {
      // Fail loud in production; on-chain settlement MUST work.
      throw new Error(msg);
    }
    console.warn(`⚠️  ${msg} (non-production: continuing with disabled oracle)`);
    return;
  }

  const provider = getProvider();
  _wallet = new ethers.Wallet(key, provider);
  console.log(`⚙️  Oracle wallet: ${_wallet.address}`);

  if (process.env.ESCROW_CONTRACT_ADDRESS) {
    _escrow = new ethers.Contract(process.env.ESCROW_CONTRACT_ADDRESS, ESCROW_ABI, _wallet);
    console.log(`⚙️  MatchEscrow: ${process.env.ESCROW_CONTRACT_ADDRESS}`);
  }
  if (process.env.TOURNAMENT_CONTRACT_ADDRESS) {
    _tournament = new ethers.Contract(process.env.TOURNAMENT_CONTRACT_ADDRESS, TOURNAMENT_ABI, _wallet);
    console.log(`⚙️  TournamentPool: ${process.env.TOURNAMENT_CONTRACT_ADDRESS}`);
  }
}

// Eagerly initialize so a misconfigured production deploy fails at boot,
// not on the first settlement.
_init();

function getOracleWallet() {
  return _wallet;
}

function getEscrowContract() {
  return _escrow;
}

function getTournamentContract() {
  return _tournament;
}

module.exports = {
  getProvider,
  getOracleWallet,
  getEscrowContract,
  getTournamentContract,
  ESCROW_ABI,
  TOURNAMENT_ABI,
};
