const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MatchEscrow", function () {
  let usdc, escrow;
  let owner, oracle, playerA, playerB, nonOracle;
  const STAKE_AMOUNT = ethers.parseUnits("10", 6); // 10 USDC
  const MATCH_ID = ethers.id("test_match_123");

  beforeEach(async function () {
    [owner, oracle, playerA, playerB, nonOracle] = await ethers.getSigners();

    // Deploy Mock USDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    // Deploy Escrow
    const MatchEscrow = await ethers.getContractFactory("MatchEscrow");
    escrow = await MatchEscrow.deploy(usdc.target, oracle.address);
    await escrow.waitForDeployment();

    // Mint USDC to players
    await usdc.mint(playerA.address, ethers.parseUnits("100", 6));
    await usdc.mint(playerB.address, ethers.parseUnits("100", 6));

    // Approve Escrow to spend USDC
    await usdc.connect(playerA).approve(escrow.target, ethers.MaxUint256);
    await usdc.connect(playerB).approve(escrow.target, ethers.MaxUint256);
  });

  describe("Deposits", function () {
    it("Should allow player A to deposit and set the stake", async function () {
      await expect(escrow.connect(playerA).deposit(MATCH_ID, playerA.address, STAKE_AMOUNT))
        .to.emit(escrow, "Deposited")
        .withArgs(MATCH_ID, playerA.address, STAKE_AMOUNT);

      const matchData = await escrow.matches(MATCH_ID);
      expect(matchData.playerA).to.equal(playerA.address);
      expect(matchData.stakeAmount).to.equal(STAKE_AMOUNT);
      expect(matchData.totalEscrowed).to.equal(STAKE_AMOUNT);
    });

    it("Should allow player B to deposit and fill the match", async function () {
      await escrow.connect(playerA).deposit(MATCH_ID, playerA.address, STAKE_AMOUNT);
      
      await expect(escrow.connect(playerB).deposit(MATCH_ID, playerB.address, STAKE_AMOUNT))
        .to.emit(escrow, "Deposited")
        .withArgs(MATCH_ID, playerB.address, STAKE_AMOUNT);

      const matchData = await escrow.matches(MATCH_ID);
      expect(matchData.playerB).to.equal(playerB.address);
      expect(matchData.totalEscrowed).to.equal(STAKE_AMOUNT * 2n);
    });

    it("Should reject deposit if stake amount does not match", async function () {
      await escrow.connect(playerA).deposit(MATCH_ID, playerA.address, STAKE_AMOUNT);
      const wrongAmount = ethers.parseUnits("5", 6);
      await expect(escrow.connect(playerB).deposit(MATCH_ID, playerB.address, wrongAmount))
        .to.be.revertedWith("Stake mismatch");
    });
  });

  describe("Settlement", function () {
    beforeEach(async function () {
      await escrow.connect(playerA).deposit(MATCH_ID, playerA.address, STAKE_AMOUNT);
      await escrow.connect(playerB).deposit(MATCH_ID, playerB.address, STAKE_AMOUNT);
    });

    it("Should allow oracle to settle and pay the winner + fee", async function () {
      const balanceBefore = await usdc.balanceOf(playerA.address);
      const ownerBalanceBefore = await usdc.balanceOf(owner.address);

      // 10 + 10 = 20 total. 5% fee = 1 USDC. Winner gets 19 USDC.
      const expectedPayout = ethers.parseUnits("19", 6);
      const expectedFee = ethers.parseUnits("1", 6);

      await expect(escrow.connect(oracle).settle(MATCH_ID, playerA.address))
        .to.emit(escrow, "Settled")
        .withArgs(MATCH_ID, playerA.address, expectedPayout);

      const balanceAfter = await usdc.balanceOf(playerA.address);
      expect(balanceAfter - balanceBefore).to.equal(expectedPayout);

      const ownerBalanceAfter = await usdc.balanceOf(owner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(expectedFee);

      const matchData = await escrow.matches(MATCH_ID);
      expect(matchData.settled).to.be.true;
    });

    it("Should reject settlement from non-oracle", async function () {
      await expect(escrow.connect(nonOracle).settle(MATCH_ID, playerA.address))
        .to.be.revertedWith("Not oracle");
    });
  });

  describe("Cancellation", function () {
    it("Should refund both players if cancelled by oracle", async function () {
      await escrow.connect(playerA).deposit(MATCH_ID, playerA.address, STAKE_AMOUNT);
      await escrow.connect(playerB).deposit(MATCH_ID, playerB.address, STAKE_AMOUNT);

      const balanceBeforeA = await usdc.balanceOf(playerA.address);
      const balanceBeforeB = await usdc.balanceOf(playerB.address);

      await expect(escrow.connect(oracle).cancel(MATCH_ID))
        .to.emit(escrow, "Cancelled")
        .withArgs(MATCH_ID);

      const balanceAfterA = await usdc.balanceOf(playerA.address);
      const balanceAfterB = await usdc.balanceOf(playerB.address);

      expect(balanceAfterA - balanceBeforeA).to.equal(STAKE_AMOUNT);
      expect(balanceAfterB - balanceBeforeB).to.equal(STAKE_AMOUNT);
    });
  });
});
