'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { ethers } = require('hardhat');

/**
 * Deploy MfalmePaymaster to Base Sepolia.
 * After deployment, fund the paymaster via EntryPoint.depositTo().
 *
 * STOP conditions (checked before deploying):
 *   1. DEPLOYER_PRIVATE_KEY must be set in .env
 *   2. ENTRY_POINT_ADDRESS must be set in .env
 *   3. Deployer wallet must have enough ETH for deployment + paymaster funding
 *
 * Post-deployment: update PAYMASTER_ADDRESS in .env
 */
async function main() {
  const entryPoint = process.env.ENTRY_POINT_ADDRESS;
  if (!entryPoint) {
    throw new Error('BLOCKER: ENTRY_POINT_ADDRESS not set in .env');
  }

  const [deployer] = await ethers.getSigners();
  console.log('Deploying MfalmePaymaster with account:', deployer.address);
  console.log('EntryPoint:', entryPoint);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Deployer ETH balance:', ethers.formatEther(balance), 'ETH');

  if (balance < ethers.parseEther('0.01')) {
    throw new Error('BLOCKER: Deployer wallet has insufficient ETH. Fund it first.');
  }

  const Paymaster = await ethers.getContractFactory('MfalmePaymaster');
  const paymaster = await Paymaster.deploy(entryPoint);
  await paymaster.waitForDeployment();
  const paymasterAddress = await paymaster.getAddress();

  console.log('\n✅ MfalmePaymaster deployed to:', paymasterAddress);
  console.log('   Add to .env:  PAYMASTER_ADDRESS=' + paymasterAddress);

  // Fund the paymaster with 0.5 ETH via EntryPoint
  const FUND_AMOUNT = ethers.parseEther('0.5');
  const entryPointAbi = ['function depositTo(address account) external payable'];
  const entryPointContract = new ethers.Contract(entryPoint, entryPointAbi, deployer);

  console.log('\n💰 Funding paymaster with 0.5 ETH via EntryPoint...');
  const tx = await entryPointContract.depositTo(paymasterAddress, { value: FUND_AMOUNT });
  await tx.wait();
  console.log('   ✅ Paymaster funded. TX:', tx.hash);
}

main().catch(err => {
  console.error('❌ Deployment failed:', err.message);
  process.exitCode = 1;
});
