// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BasePaymaster} from "@account-abstraction/contracts/core/BasePaymaster.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MfalmePaymaster
 * @notice ERC-4337 Paymaster that sponsors all platform operations for Mfalme Arena users.
 *         Sponsored operations include: deposit, challenge, accept, register, settle.
 *         Users never pay gas — the platform covers all transaction fees.
 *
 * @dev Inherits BasePaymaster from eth-infinitism/account-abstraction.
 *      The paymaster must be funded with ETH (deposited into the EntryPoint)
 *      before it can sponsor UserOperations.
 *      Recommendation: Fund with at least 0.5 ETH on Base Sepolia for testing.
 */
contract MfalmePaymaster is BasePaymaster {
    constructor(IEntryPoint _entryPoint) BasePaymaster(_entryPoint) Ownable(msg.sender) {
    }

    /**
     * @notice Validates a UserOperation and decides whether to sponsor it.
     * @dev Current policy: sponsor ALL operations from any sender.
     *      Future enhancement: restrict to allowlisted callers or specific calldata selectors.
     * @param userOp     The UserOperation being validated
     * @param userOpHash The hash of the UserOperation
     * @param maxCost    The maximum gas cost the paymaster may incur
     * @return context        Passed to postOp — empty here since we track nothing
     * @return validationData 0 = valid, no time range restrictions
     */
    function _validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) internal view override returns (bytes memory context, uint256 validationData) {
        // Suppress unused variable warnings
        userOp;
        userOpHash;
        maxCost;
        // Sponsor all platform operations: deposit, challenge, accept, register, settle
        return ("", 0);
    }
}
