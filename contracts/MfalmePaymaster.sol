// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BasePaymaster} from "@account-abstraction/contracts/core/BasePaymaster.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MfalmePaymaster
 * @notice ERC-4337 Paymaster that sponsors Mfalme Arena platform operations.
 *
 *         The paymaster only sponsors UserOperations whose inner call targets
 *         a contract on `allowedTargets`. Currently expected: MatchEscrow,
 *         TournamentPool. Owner manages the allowlist.
 *
 *         The paymaster also enforces a per-op `maxCostCap` (in wei) to limit
 *         griefing by oversized gas estimates.
 *
 *         Supported smart-account call shapes:
 *           - execute(address,uint256,bytes)          (SimpleAccount, LightAccount, Kernel)
 *           - executeBatch((address,uint256,bytes)[]) (Modular Account, Coinbase Smart Wallet)
 *
 *         Calls in any other shape are rejected (fail-closed).
 */
contract MfalmePaymaster is BasePaymaster {
    bytes4 private constant EXECUTE_SELECTOR = 0xb61d27f6;
    bytes4 private constant EXECUTE_BATCH_CALLS_SELECTOR = 0x34fcd5be;

    mapping(address => bool) public allowedTargets;
    uint256 public maxCostCap;

    event TargetAllowed(address indexed target, bool allowed);
    event MaxCostCapUpdated(uint256 newCap);

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    constructor(IEntryPoint _entryPoint, uint256 _maxCostCap)
        BasePaymaster(_entryPoint)
        Ownable(msg.sender)
    {
        maxCostCap = _maxCostCap;
        emit MaxCostCapUpdated(_maxCostCap);
    }

    function setAllowedTarget(address target, bool allowed) external onlyOwner {
        require(target != address(0), "Paymaster: zero target");
        allowedTargets[target] = allowed;
        emit TargetAllowed(target, allowed);
    }

    function setMaxCostCap(uint256 newCap) external onlyOwner {
        maxCostCap = newCap;
        emit MaxCostCapUpdated(newCap);
    }

    function _validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 /* userOpHash */,
        uint256 maxCost
    ) internal view override returns (bytes memory context, uint256 validationData) {
        require(maxCost <= maxCostCap, "Paymaster: maxCost exceeds cap");

        bytes calldata cd = userOp.callData;
        require(cd.length >= 4, "Paymaster: callData too short");

        bytes4 selector = bytes4(cd[:4]);

        if (selector == EXECUTE_SELECTOR) {
            (address target, , ) = abi.decode(cd[4:], (address, uint256, bytes));
            require(allowedTargets[target], "Paymaster: target not allowed");
        } else if (selector == EXECUTE_BATCH_CALLS_SELECTOR) {
            Call[] memory calls = abi.decode(cd[4:], (Call[]));
            uint256 len = calls.length;
            require(len > 0, "Paymaster: empty batch");
            for (uint256 i = 0; i < len; i++) {
                require(allowedTargets[calls[i].target], "Paymaster: batch target not allowed");
            }
        } else {
            revert("Paymaster: unsupported call shape");
        }

        return ("", 0);
    }
}
