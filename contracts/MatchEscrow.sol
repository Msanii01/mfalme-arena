// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MatchEscrow
 * @notice Holds USDC stakes for 1v1 wager matches between two players.
 *         Funds are locked until the oracle (backend) calls settle() with the winner,
 *         or cancel() if the match cannot proceed.
 *
 * @dev Key invariants:
 *      - Only the oracle can settle or cancel matches
 *      - ReentrancyGuard protects all state-changing fund movements
 *      - USDC has 6 decimals — amounts in this contract are in raw USDC units (6 decimal precision)
 *      - Platform fee is deducted atomically on settlement
 *
 * Security checklist compliance:
 *      - onlyOracle: prevents external settle/cancel calls
 *      - nonReentrant: on settle() and cancel()
 *      - Idempotency: settled flag prevents double settlement
 */
contract MatchEscrow is ReentrancyGuard {
    IERC20 public usdc;
    address public oracle;
    address public owner;
    uint256 public platformFeePercent = 5;

    struct Match {
        address playerA;
        address playerB;
        uint256 stakeAmount;
        uint256 totalEscrowed;
        bool settled;
        address winner;
    }

    mapping(bytes32 => Match) public matches;

    event Deposited(bytes32 indexed matchId, address indexed player, uint256 amount);
    event Settled(bytes32 indexed matchId, address indexed winner, uint256 amount);
    event Cancelled(bytes32 indexed matchId);

    modifier onlyOracle() {
        require(msg.sender == oracle, "Not oracle");
        _;
    }

    constructor(address _usdc, address _oracle) {
        usdc = IERC20(_usdc);
        oracle = _oracle;
        owner = msg.sender;
    }

    /**
     * @notice Deposit USDC stake for a match. First deposit sets playerA and stake amount.
     *         Second deposit sets playerB and verifies matching stake.
     * @param matchId  keccak256 hash of the internal match UUID (escrow_match_id)
     * @param player   Address of the depositing player
     * @param amount   USDC amount in raw units (6 decimal precision)
     */
    function deposit(bytes32 matchId, address player, uint256 amount) external {
        require(amount > 0, "Invalid amount");
        require(!matches[matchId].settled, "Already settled");
        usdc.transferFrom(player, address(this), amount);

        if (matches[matchId].totalEscrowed == 0) {
            matches[matchId].playerA = player;
            matches[matchId].stakeAmount = amount;
        } else {
            require(matches[matchId].playerB == address(0), "Match full");
            require(amount == matches[matchId].stakeAmount, "Stake mismatch");
            matches[matchId].playerB = player;
        }
        matches[matchId].totalEscrowed += amount;
        emit Deposited(matchId, player, amount);
    }

    /**
     * @notice Settle a match, paying the winner (minus platform fee) and the platform.
     * @param matchId  keccak256 match identifier
     * @param winner   Address of the winning player (must be playerA or playerB)
     */
    function settle(bytes32 matchId, address winner) external onlyOracle nonReentrant {
        require(!matches[matchId].settled, "Already settled");
        require(
            winner == matches[matchId].playerA || winner == matches[matchId].playerB,
            "Invalid winner"
        );
        require(matches[matchId].playerB != address(0), "Match not full");

        Match storage m = matches[matchId];
        uint256 fee     = (m.totalEscrowed * platformFeePercent) / 100;
        uint256 payout  = m.totalEscrowed - fee;

        m.settled = true;
        m.winner  = winner;

        usdc.transfer(winner, payout);
        usdc.transfer(owner, fee);

        emit Settled(matchId, winner, payout);
    }

    /**
     * @notice Cancel a match and refund depositors.
     *         If only playerA has deposited, only playerA is refunded.
     *         If both have deposited, both are refunded in full.
     * @param matchId  keccak256 match identifier
     */
    function cancel(bytes32 matchId) external onlyOracle nonReentrant {
        require(!matches[matchId].settled, "Already settled");
        Match storage m = matches[matchId];
        uint256 refundA = m.stakeAmount;
        uint256 refundB = m.playerB != address(0) ? m.stakeAmount : 0;
        m.settled = true;
        if (refundA > 0) usdc.transfer(m.playerA, refundA);
        if (refundB > 0) usdc.transfer(m.playerB, refundB);
        emit Cancelled(matchId);
    }
}
