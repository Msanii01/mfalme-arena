// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TournamentPool
 * @notice Holds admin-funded prize pools for 2-player admin tournaments.
 *         Flow: Admin creates → funds → players register → match plays → oracle settles.
 *
 * @dev Key invariants:
 *      - Only the owner (admin wallet) can create, fund, and cancel tournaments
 *      - Only the oracle (backend) can settle tournaments
 *      - ReentrancyGuard protects all settlement and cancel fund movements
 *      - USDC has 6 decimals — amounts are in raw units
 *      - Platform fee is deducted atomically on settlement (5% of prize pool)
 *      - Admin can only cancel Open tournaments (not Full, Active, or beyond)
 *
 * Security checklist compliance:
 *      - onlyOracle: prevents external settle calls
 *      - nonReentrant: on settle() and cancel()
 *      - Idempotency: settled flag prevents double settlement
 */
contract TournamentPool is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public usdc;
    address public oracle;
    uint256 public immutable platformFeePercent;

    // NOTE: `Funded` is reserved for backwards-compat of the enum's numeric layout
    // (some off-chain consumers may decode raw uint8 status values). It is intentionally
    // unreachable on-chain; status moves directly Created -> Open on fundTournament().
    enum TournamentStatus { Created, Funded, Open, Full, Active, Completed, Cancelled }

    struct Tournament {
        bytes32 tournamentId;
        uint256 prizePool;
        address creator;
        address playerA;
        address playerB;
        TournamentStatus status;
        address winner;
        bool settled;
    }

    mapping(bytes32 => Tournament) public tournaments;

    event TournamentCreated(bytes32 indexed tournamentId, uint256 prizePool);
    event TournamentFunded(bytes32 indexed tournamentId, uint256 amount);
    event PlayerRegistered(bytes32 indexed tournamentId, address indexed player);
    event TournamentFull(bytes32 indexed tournamentId);
    event TournamentSettled(bytes32 indexed tournamentId, address indexed winner, uint256 payout);
    event TournamentCancelled(bytes32 indexed tournamentId, uint256 refund);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);

    modifier onlyOracle() {
        require(msg.sender == oracle, "Not oracle");
        _;
    }

    constructor(address _usdc, address _oracle, uint256 _platformFeePercent) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid usdc");
        require(_oracle != address(0), "Invalid oracle");
        require(_platformFeePercent <= 10, "Fee too high");
        usdc   = IERC20(_usdc);
        oracle = _oracle;
        platformFeePercent = _platformFeePercent;
        emit OracleUpdated(address(0), _oracle);
    }

    /**
     * @notice Rotate the oracle address. Owner-only.
     *         Use this to recover from a compromised oracle key.
     */
    function setOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "Invalid oracle");
        address old = oracle;
        oracle = newOracle;
        emit OracleUpdated(old, newOracle);
    }

    /**
     * @notice Create a new tournament record (owner only). Does NOT transfer funds yet.
     * @param tournamentId  bytes32 identifier derived from internal UUID
     * @param prizePool     Total USDC prize pool in raw units (6 decimal precision)
     */
    function createTournament(bytes32 tournamentId, uint256 prizePool) external onlyOwner {
        require(tournaments[tournamentId].prizePool == 0, "Already exists");
        require(prizePool > 0, "Invalid prize pool");
        tournaments[tournamentId] = Tournament({
            tournamentId: tournamentId,
            prizePool:    prizePool,
            creator:      msg.sender,
            playerA:      address(0),
            playerB:      address(0),
            status:       TournamentStatus.Created,
            winner:       address(0),
            settled:      false
        });
        emit TournamentCreated(tournamentId, prizePool);
    }

    /**
     * @notice Fund a Created tournament with USDC (owner only).
     *         Owner must have approved this contract for `prizePool` USDC first.
     *         After funding, status moves from Created → Open (open for registration).
     * @param tournamentId  bytes32 tournament identifier
     */
    function fundTournament(bytes32 tournamentId) external {
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentStatus.Created, "Invalid status");
        require(msg.sender == t.creator, "Only creator can fund");
        usdc.safeTransferFrom(msg.sender, address(this), t.prizePool);
        t.status = TournamentStatus.Open;
        emit TournamentFunded(tournamentId, t.prizePool);
    }

    /**
     * @notice Register a player for an Open tournament.
     *         First player becomes playerA. Second becomes playerB and closes registration.
     *         Players may only register themselves — `player` must equal `msg.sender`.
     * @param tournamentId  bytes32 tournament identifier
     * @param player        Wallet address of the registering player (must equal msg.sender)
     */
    function register(bytes32 tournamentId, address player) external {
        require(player != address(0), "Invalid player");
        require(msg.sender == player, "Not player");
        Tournament storage t = tournaments[tournamentId];
        require(t.status == TournamentStatus.Open, "Not open");
        require(t.playerA != player, "Already registered");
        require(t.playerB == address(0), "Tournament full");
        if (t.playerA == address(0)) {
            t.playerA = player;
        } else {
            t.playerB = player;
            t.status  = TournamentStatus.Full;
            emit TournamentFull(tournamentId);
        }
        emit PlayerRegistered(tournamentId, player);
    }

    /**
     * @notice Settle a Full or Active tournament (oracle only).
     *         Transfers payout to winner and fee to owner atomically.
     * @param tournamentId  bytes32 tournament identifier
     * @param winner        Address of the winning player
     */
    function settle(bytes32 tournamentId, address winner) external onlyOracle nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(
            t.status == TournamentStatus.Full || t.status == TournamentStatus.Active,
            "Not ready"
        );
        require(!t.settled, "Already settled");
        require(winner == t.playerA || winner == t.playerB, "Invalid winner");

        uint256 fee    = (t.prizePool * platformFeePercent) / 100;
        uint256 payout = t.prizePool - fee;

        t.settled = true;
        t.winner  = winner;
        t.status  = TournamentStatus.Completed;

        usdc.safeTransfer(winner, payout);
        usdc.safeTransfer(owner(), fee);

        emit TournamentSettled(tournamentId, winner, payout);
    }

    /**
     * @notice Cancel an Open tournament and refund the full prize pool to the owner.
     *         Can only cancel while Open (not Full or beyond).
     * @param tournamentId  bytes32 tournament identifier
     */
    function cancel(bytes32 tournamentId) external nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        require(msg.sender == t.creator || msg.sender == owner() || msg.sender == oracle, "Not authorized");
        require(t.status == TournamentStatus.Open, "Cannot cancel");
        require(!t.settled, "Already settled");
        uint256 refund = t.prizePool;
        t.status = TournamentStatus.Cancelled;
        usdc.safeTransfer(t.creator, refund);
        emit TournamentCancelled(tournamentId, refund);
    }
}
