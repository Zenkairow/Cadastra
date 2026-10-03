// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../TransferEscrow.sol";

/**
 * @title MaliciousReceiver
 * @dev Attacker contract attempting recursive reentrancy attacks against TransferEscrow.withdrawFunds()
 */
contract MaliciousReceiver {
    TransferEscrow public immutable escrow;
    uint256 public attackCount;
    bool public attackAttempted;

    constructor(address payable _escrow) {
        escrow = TransferEscrow(_escrow);
    }

    // Fallback function triggered when receiving funds
    receive() external payable {
        if (attackCount < 3) {
            attackCount++;
            attackAttempted = true;
            // Attempt to re-enter withdrawFunds
            (bool success, ) = address(escrow).call(abi.encodeWithSignature("withdrawFunds()"));
            // success is expected to be false due to nonReentrant and CEI
        }
    }

    function triggerWithdraw() external {
        escrow.withdrawFunds();
    }
}
