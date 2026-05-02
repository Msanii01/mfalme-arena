'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { ethers } = require('hardhat');

/**
 * Deploy MatchEscrow to Base Sepolia.
 *
 * STOP conditions:
 *   1. USDC_CONTRACT_ADDRESS must be set in .env
 *   2. ADMIN_WALLET_ADDRESS must be set in .env (this becomes the oracle)
 *      ASSUMPTION: The backend oracle wallet = ADMIN_WALLET_ADDRESS.
 *                  The oracle calls settle() and cancel() via the backend service.
 *
 * Post-deployment: update ESCROW_CONTRACT_ADDRESS in .env
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
  console.log('Deploying MatchEscrow with account:', deployer.address);
  console.log('USDC:', usdcAddress);
  console.log('Oracle (backend wallet):', oracleAddress);

  const platformFeePercent = 5;

  const Escrow = await ethers.getContractFactory('MatchEscrow');
  const escrow = await Escrow.deploy(usdcAddress, oracleAddress, platformFeePercent);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();

  console.log('\n✅ MatchEscrow deployed to:', escrowAddress);
  console.log('   Add to .env:  ESCROW_CONTRACT_ADDRESS=' + escrowAddress);
}

main().catch(err => {
  console.error('❌ Deployment failed:', err.message);
  process.exitCode = 1;
});
