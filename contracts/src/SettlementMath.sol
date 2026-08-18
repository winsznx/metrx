// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title SettlementMath
/// @notice Pure payout arithmetic for every terminal Metrx outcome.
/// @dev Kept free of storage so the same rules can be mirrored 1:1 by the
///      off-chain reference model in `packages/reference/src/settlementModel.ts`.
///      Every branch conserves value: escrowed price plus any slashed stake is
///      fully assigned, and released stake never exceeds what was locked.
library SettlementMath {
    struct Payout {
        uint256 toBuyer;
        uint256 toOperator;
        uint256 slashed;
        uint256 unlocked;
    }

    /// @notice AI verifier returned PASS. Operator earns the escrow, stake is released untouched.
    function onPass(uint256 price, uint256 lockedStake) internal pure returns (Payout memory p) {
        p.toOperator = price;
        p.unlocked = lockedStake;
    }

    /// @notice AI verifier returned FAIL. Buyer is made whole and takes the slashed stake.
    function onFail(uint256 price, uint256 lockedStake, uint256 maxSlash) internal pure returns (Payout memory p) {
        uint256 slashed = maxSlash > lockedStake ? lockedStake : maxSlash;
        p.slashed = slashed;
        p.toBuyer = price + slashed;
        p.unlocked = lockedStake - slashed;
    }

    /// @notice Delivery deadline passed on an accepted order. Same economics as FAIL.
    function onUndelivered(uint256 price, uint256 lockedStake, uint256 maxSlash)
        internal
        pure
        returns (Payout memory p)
    {
        return onFail(price, lockedStake, maxSlash);
    }

    /// @notice Delivery deadline passed on an order nobody accepted. Nothing to slash.
    function onUnaccepted(uint256 price) internal pure returns (Payout memory p) {
        p.toBuyer = price;
    }

    /// @notice Buyer cancelled before an operator committed. Nothing to slash.
    function onCancelled(uint256 price) internal pure returns (Payout memory p) {
        p.toBuyer = price;
    }

    /// @notice Output was delivered but no signed verdict arrived in time.
    /// @dev Deliberately conservative: the operator failed no obligation it controls,
    ///      so its stake is released in full and only the escrow returns to the buyer.
    function onVerifierTimeout(uint256 price, uint256 lockedStake) internal pure returns (Payout memory p) {
        p.toBuyer = price;
        p.unlocked = lockedStake;
    }
}
