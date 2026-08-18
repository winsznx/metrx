// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MetrxCore} from "../src/MetrxCore.sol";
import {SettlementMath} from "../src/SettlementMath.sol";

/// @notice Property tests for the payout arithmetic and signature gate.
contract MetrxCoreFuzzTest is Test {
    MetrxCore internal core;

    uint256 internal constant VERIFIER_PK = 0xA11CE;
    address internal verifier;
    address internal buyer = address(0xB1);
    address internal operator = address(0x0F);

    bytes32 internal constant JOB_SPEC = keccak256("job-spec");
    bytes32 internal constant INPUT = keccak256("input");
    bytes32 internal constant RUBRIC = keccak256("rubric");
    bytes32 internal constant MODEL = keccak256("model");
    bytes32 internal constant OUTPUT = keccak256("output");
    bytes32 internal constant ARTIFACT = keccak256("artifact");
    bytes32 internal constant REASON = keccak256("reason");

    function setUp() public {
        verifier = vm.addr(VERIFIER_PK);
        core = new MetrxCore(verifier);
        vm.warp(1_800_000_000);
        vm.deal(buyer, 1_000_000 ether);
        vm.deal(operator, 1_000_000 ether);
    }

    function _sign(uint256 pk, uint256 orderId, MetrxCore.Verdict verdict, uint16 scoreBps, uint64 evaluatedAt)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                core.AI_VERDICT_TYPEHASH(),
                orderId,
                JOB_SPEC,
                INPUT,
                RUBRIC,
                MODEL,
                OUTPUT,
                uint8(verdict),
                scoreBps,
                REASON,
                evaluatedAt
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", core.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _setup(uint256 price, uint256 maxSlash, uint256 stake) internal returns (uint256 orderId) {
        vm.prank(operator);
        core.registerOperator{value: stake}("m");
        vm.prank(buyer);
        orderId = core.createOrder{value: price}(
            JOB_SPEC,
            INPUT,
            RUBRIC,
            MODEL,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours),
            maxSlash
        );
        vm.prank(operator);
        core.acceptOrder(orderId);
        vm.prank(operator);
        core.submitDelivery(orderId, OUTPUT, ARTIFACT);
    }

    // -----------------------------------------------------------------------
    // Payout properties
    // -----------------------------------------------------------------------

    /// @dev PASS always moves exactly `price` to the operator and never touches stake.
    function testFuzz_passConservesValue(uint96 priceRaw, uint96 maxSlashRaw, uint96 extraStakeRaw, uint16 scoreBps)
        public
    {
        uint256 price = bound(uint256(priceRaw), 1, 10_000 ether);
        uint256 maxSlash = bound(uint256(maxSlashRaw), 1, 10_000 ether);
        uint256 stake = maxSlash + bound(uint256(extraStakeRaw), core.MIN_STAKE(), 10_000 ether);
        scoreBps = uint16(bound(uint256(scoreBps), 0, core.MAX_SCORE_BPS()));

        uint256 orderId = _setup(price, maxSlash, stake);
        uint256 opBefore = operator.balance;
        uint256 buyerBefore = buyer.balance;

        bytes memory sig = _sign(VERIFIER_PK, orderId, MetrxCore.Verdict.Pass, scoreBps, uint64(block.timestamp));
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, scoreBps, REASON, uint64(block.timestamp), sig);

        assertEq(operator.balance, opBefore + price, "operator paid exactly price");
        assertEq(buyer.balance, buyerBefore, "buyer untouched");
        MetrxCore.Operator memory op = core.getOperator(operator);
        assertEq(op.stake, stake, "stake intact");
        assertEq(op.lockedStake, 0, "stake released");
        assertEq(address(core).balance, stake, "escrow drained to stake only");
    }

    /// @dev FAIL always returns the escrow plus exactly `maxSlash` of stake to the buyer.
    function testFuzz_failConservesValue(uint96 priceRaw, uint96 maxSlashRaw, uint96 extraStakeRaw, uint16 scoreBps)
        public
    {
        uint256 price = bound(uint256(priceRaw), 1, 10_000 ether);
        uint256 maxSlash = bound(uint256(maxSlashRaw), 1, 10_000 ether);
        uint256 stake = maxSlash + bound(uint256(extraStakeRaw), core.MIN_STAKE(), 10_000 ether);
        scoreBps = uint16(bound(uint256(scoreBps), 0, core.MAX_SCORE_BPS()));

        uint256 orderId = _setup(price, maxSlash, stake);
        uint256 opBefore = operator.balance;
        uint256 buyerBefore = buyer.balance;

        bytes memory sig = _sign(VERIFIER_PK, orderId, MetrxCore.Verdict.Fail, scoreBps, uint64(block.timestamp));
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Fail, scoreBps, REASON, uint64(block.timestamp), sig);

        assertEq(buyer.balance, buyerBefore + price + maxSlash, "buyer refunded plus slash");
        assertEq(operator.balance, opBefore, "operator paid nothing");
        MetrxCore.Operator memory op = core.getOperator(operator);
        assertEq(op.stake, stake - maxSlash, "stake reduced by exactly maxSlash");
        assertEq(op.slashed, maxSlash);
        assertEq(op.lockedStake, 0);
        assertEq(address(core).balance, stake - maxSlash);
    }

    /// @dev Slashing can never exceed what was locked for the order.
    function testFuzz_slashNeverExceedsLockedStake(uint96 maxSlashRaw, uint96 lockedRaw) public pure {
        uint256 maxSlash = uint256(maxSlashRaw);
        uint256 locked = uint256(lockedRaw);
        SettlementMath.Payout memory p = SettlementMath.onFail(1 ether, locked, maxSlash);
        assertLe(p.slashed, locked);
        assertLe(p.slashed, maxSlash);
        assertEq(p.slashed + p.unlocked, locked);
        assertEq(p.toBuyer, 1 ether + p.slashed);
    }

    // -----------------------------------------------------------------------
    // Signature properties
    // -----------------------------------------------------------------------

    /// @dev No private key other than the registered verifier can settle an order.
    function testFuzz_onlyVerifierKeySettles(uint256 pk) public {
        pk = bound(pk, 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);
        vm.assume(pk != VERIFIER_PK);

        uint256 orderId = _setup(1 ether, 0.5 ether, 2 ether);
        bytes memory sig = _sign(pk, orderId, MetrxCore.Verdict.Pass, 9000, uint64(block.timestamp));

        vm.expectRevert(abi.encodeWithSelector(MetrxCore.UnauthorizedVerifier.selector, vm.addr(pk)));
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9000, REASON, uint64(block.timestamp), sig);
    }

    /// @dev Arbitrary 65-byte blobs never settle an order.
    function testFuzz_randomSignatureNeverSettles(bytes32 r, bytes32 s, uint8 v) public {
        uint256 orderId = _setup(1 ether, 0.5 ether, 2 ether);
        bytes memory sig = abi.encodePacked(r, s, v);

        try core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9000, REASON, uint64(block.timestamp), sig) {
            fail();
        } catch {
            assertEq(uint8(core.getOrder(orderId).status), uint8(MetrxCore.OrderStatus.Delivered));
        }
    }

    /// @dev A certificate is bound to one order id; it cannot be replayed onto another.
    function testFuzz_certificateIsNotPortableAcrossOrders(uint8 extraOrders) public {
        uint256 n = bound(uint256(extraOrders), 1, 5);
        uint256 first = _setup(1 ether, 0.1 ether, 10 ether);
        bytes memory sig = _sign(VERIFIER_PK, first, MetrxCore.Verdict.Pass, 9000, uint64(block.timestamp));

        for (uint256 i = 0; i < n; i++) {
            vm.prank(buyer);
            uint256 other = core.createOrder{value: 1 ether}(
                JOB_SPEC,
                INPUT,
                RUBRIC,
                MODEL,
                uint64(block.timestamp + 1 hours),
                uint64(block.timestamp + 2 hours),
                0.1 ether
            );
            vm.prank(operator);
            core.acceptOrder(other);
            vm.prank(operator);
            core.submitDelivery(other, OUTPUT, ARTIFACT);

            vm.expectRevert();
            core.settleWithAIVerdict(other, MetrxCore.Verdict.Pass, 9000, REASON, uint64(block.timestamp), sig);
        }
    }
}
