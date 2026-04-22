'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { ethers } = require('hardhat');

/**
 * Deploy TournamentPool to Base Sepolia.
 *
 * STOP conditions:
 *   1. USDC_CONTRACT_ADDRESS must be set in .env
 *   2. ADMIN_WALLET_ADDRESS must be set in .env (this becomes the oracle)
 *
 * Post-deployment: update TOURNAMENT_CONTRACT_ADDRESS in .env
 */
async function main() {
  const usdcAddress   = process.env.USDC_CONTRACT_ADDRESS;
  const oracleAddress = process.env.ADMIN_WALLET_ADDRESS;

  if (!usdcAddress) {
    throw new Error('BLOCKER: USDC_CONTRACT_ADDRESS not set in .env');
  }
  if (!oracleAddress) {
    throw new Error('BLOCKER: ADMIN_WALLET_ADDRESS not set in .env (this is the oracle address)');
  }

  const [deployer] = await ethers.getSigners();
  console.log('Deploying TournamentPool with account:', deployer.address);
  console.log('USDC:', usdcAddress);
  console.log('Oracle (backend wallet):', oracleAddress);

  const TournamentPool = await ethers.getContractFactory('TournamentPool');
  const pool = await TournamentPool.deploy(usdcAddress, oracleAddress);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();

  console.log('\n✅ TournamentPool deployed to:', poolAddress);
  console.log('   Add to .env:  TOURNAMENT_CONTRACT_ADDRESS=' + poolAddress);
}

main().catch(err => {
  console.error('❌ Deployment failed:', err.message);
  process.exitCode = 1;
});
