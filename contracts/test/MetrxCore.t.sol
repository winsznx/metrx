// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MetrxCore} from "../src/MetrxCore.sol";

/// @dev Recipient that rejects plain transfers, used to prove escrow can never be stranded.
contract RejectingRecipient {
    receive() external payable {
        revert("no");
    }

    function pull(MetrxCore core) external {
        core.withdraw();
    }
}

/// @dev Attempts to re-enter settlement while receiving its payout.
contract ReentrantBuyer {
    MetrxCore public core;
    uint256 public orderId;
    bool public attempted;
    bool public reentryReverted;

    function arm(MetrxCore core_, uint256 orderId_) external {
        core = core_;
        orderId = orderId_;
    }

    function create(
        MetrxCore core_,
        bytes32 jobSpecHash,
        bytes32 inputHash,
        bytes32 rubricHash,
        bytes32 modelHash,
        uint64 deliveryDeadline,
        uint64 verificationDeadline,
        uint256 maxSlash
    ) external payable returns (uint256) {
        return core_.createOrder{value: msg.value}(
            jobSpecHash, inputHash, rubricHash, modelHash, deliveryDeadline, verificationDeadline, maxSlash
        );
    }

    receive() external payable {
        if (attempted) return;
        attempted = true;
        try core.finalizeVerifierTimeout(orderId) {
            reentryReverted = false;
        } catch {
            reentryReverted = true;
        }
    }
}

contract MetrxCoreTest is Test {
    MetrxCore internal core;

    uint256 internal constant VERIFIER_PK = 0xA11CE;
    address internal verifier;

    address internal buyer = address(0xB1);
    address internal operator = address(0x0F);
    address internal stranger = address(0x5E);

    bytes32 internal constant JOB_SPEC = keccak256("job-spec");
    bytes32 internal constant INPUT = keccak256("input");
    bytes32 internal constant RUBRIC = keccak256("rubric");
    bytes32 internal constant MODEL = keccak256("model");
    bytes32 internal constant OUTPUT = keccak256("output");
    bytes32 internal constant ARTIFACT = keccak256("artifact");
    bytes32 internal constant REASON = keccak256("reason");

    uint256 internal constant PRICE = 1 ether;
    uint256 internal constant MAX_SLASH = 0.5 ether;
    uint256 internal constant STAKE = 2 ether;

    function setUp() public {
        verifier = vm.addr(VERIFIER_PK);
        core = new MetrxCore(verifier);

        vm.deal(buyer, 100 ether);
        vm.deal(operator, 100 ether);
        vm.deal(stranger, 100 ether);
        vm.warp(1_800_000_000);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function _deadlines() internal view returns (uint64 delivery, uint64 verification) {
        delivery = uint64(block.timestamp + 1 hours);
        verification = uint64(block.timestamp + 2 hours);
    }

    function _createOrder() internal returns (uint256 orderId) {
        (uint64 d, uint64 v) = _deadlines();
        vm.prank(buyer);
        orderId = core.createOrder{value: PRICE}(JOB_SPEC, INPUT, RUBRIC, MODEL, d, v, MAX_SLASH);
    }

    function _registerOperator() internal {
        vm.prank(operator);
        core.registerOperator{value: STAKE}("ipfs://operator");
    }

    function _fundedAcceptedDelivered() internal returns (uint256 orderId) {
        _registerOperator();
        orderId = _createOrder();
        vm.prank(operator);
        core.acceptOrder(orderId);
        vm.prank(operator);
        core.submitDelivery(orderId, OUTPUT, ARTIFACT);
    }

    /// @dev Mirrors the EIP-712 AIVerdict payload. Kept as a struct so tests can mutate one
    ///      field at a time and prove the signature stops recovering to the verifier.
    struct Cert {
        uint256 orderId;
        bytes32 jobSpecHash;
        bytes32 inputHash;
        bytes32 rubricHash;
        bytes32 modelHash;
        bytes32 outputHash;
        MetrxCore.Verdict verdict;
        uint16 scoreBps;
        bytes32 reasonHash;
        uint64 evaluatedAt;
    }

    function _cert(uint256 orderId, MetrxCore.Verdict verdict, uint16 scoreBps) internal view returns (Cert memory c) {
        c = Cert({
            orderId: orderId,
            jobSpecHash: JOB_SPEC,
            inputHash: INPUT,
            rubricHash: RUBRIC,
            modelHash: MODEL,
            outputHash: OUTPUT,
            verdict: verdict,
            scoreBps: scoreBps,
            reasonHash: REASON,
            evaluatedAt: uint64(block.timestamp)
        });
    }

    function _digest(Cert memory c) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                core.AI_VERDICT_TYPEHASH(),
                c.orderId,
                c.jobSpecHash,
                c.inputHash,
                c.rubricHash,
                c.modelHash,
                c.outputHash,
                uint8(c.verdict),
                c.scoreBps,
                c.reasonHash,
                c.evaluatedAt
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", core.domainSeparator(), structHash));
    }

    function _sign(uint256 pk, Cert memory c) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(c));
        return abi.encodePacked(r, s, v);
    }

    function _signHonest(uint256 orderId, MetrxCore.Verdict verdict, uint16 scoreBps)
        internal
        view
        returns (bytes memory)
    {
        return _sign(VERIFIER_PK, _cert(orderId, verdict, scoreBps));
    }

    // -----------------------------------------------------------------------
    // Operator registry
    // -----------------------------------------------------------------------

    function test_registerOperator_setsStakeAndActive() public {
        _registerOperator();
        MetrxCore.Operator memory op = core.getOperator(operator);
        assertEq(op.owner, operator);
        assertEq(op.stake, STAKE);
        assertEq(op.lockedStake, 0);
        assertTrue(op.active);
        assertEq(op.metadataURI, "ipfs://operator");
    }

    function test_registerOperator_revertsBelowMinStake() public {
        uint256 tooLittle = core.MIN_STAKE() - 1;
        vm.prank(operator);
        vm.expectRevert(MetrxCore.StakeTooLow.selector);
        core.registerOperator{value: tooLittle}("x");
    }

    function test_registerOperator_revertsOnDoubleRegistration() public {
        _registerOperator();
        vm.prank(operator);
        vm.expectRevert(MetrxCore.AlreadyRegistered.selector);
        core.registerOperator{value: STAKE}("x");
    }

    function test_addStake_requiresRegistration() public {
        vm.prank(operator);
        vm.expectRevert(MetrxCore.NotRegistered.selector);
        core.addStake{value: 1 ether}();
    }

    function test_operatorCannotWithdrawLockedStake() public {
        _registerOperator();
        uint256 orderId = _createOrder();
        vm.prank(operator);
        core.acceptOrder(orderId);

        assertEq(core.availableStake(operator), STAKE - MAX_SLASH);

        vm.prank(operator);
        vm.expectRevert(MetrxCore.InsufficientUnlockedStake.selector);
        core.withdrawUnlockedStake(STAKE - MAX_SLASH + 1);

        uint256 before = operator.balance;
        vm.prank(operator);
        core.withdrawUnlockedStake(STAKE - MAX_SLASH);
        assertEq(operator.balance, before + STAKE - MAX_SLASH);
    }

    function test_operatorCannotAcceptWithoutEnoughUnlockedStake() public {
        vm.prank(operator);
        core.registerOperator{value: MAX_SLASH - 1}("x");
        uint256 orderId = _createOrder();
        vm.prank(operator);
        vm.expectRevert(MetrxCore.InsufficientUnlockedStake.selector);
        core.acceptOrder(orderId);
    }

    // -----------------------------------------------------------------------
    // Order creation guards
    // -----------------------------------------------------------------------

    function test_createOrder_requiresPrice() public {
        (uint64 d, uint64 v) = _deadlines();
        vm.prank(buyer);
        vm.expectRevert(MetrxCore.PriceRequired.selector);
        core.createOrder{value: 0}(JOB_SPEC, INPUT, RUBRIC, MODEL, d, v, MAX_SLASH);
    }

    function test_createOrder_requiresMaxSlash() public {
        (uint64 d, uint64 v) = _deadlines();
        vm.prank(buyer);
        vm.expectRevert(MetrxCore.MaxSlashRequired.selector);
        core.createOrder{value: PRICE}(JOB_SPEC, INPUT, RUBRIC, MODEL, d, v, 0);
    }

    function test_createOrder_requiresJobHashes() public {
        (uint64 d, uint64 v) = _deadlines();
        vm.prank(buyer);
        vm.expectRevert(MetrxCore.MissingJobHashes.selector);
        core.createOrder{value: PRICE}(bytes32(0), INPUT, RUBRIC, MODEL, d, v, MAX_SLASH);
    }

    function test_createOrder_rejectsBadDeadlineOrdering() public {
        vm.prank(buyer);
        vm.expectRevert(MetrxCore.BadDeadlines.selector);
        core.createOrder{value: PRICE}(
            JOB_SPEC, INPUT, RUBRIC, MODEL, uint64(block.timestamp + 2 hours), uint64(block.timestamp + 1 hours), MAX_SLASH
        );
    }

    function test_createOrder_rejectsDeadlineBeyondHorizon() public {
        vm.prank(buyer);
        vm.expectRevert(MetrxCore.DeadlineTooFar.selector);
        core.createOrder{value: PRICE}(
            JOB_SPEC, INPUT, RUBRIC, MODEL, uint64(block.timestamp + 1 hours), uint64(block.timestamp + 31 days), MAX_SLASH
        );
    }

    function test_orderIdsIncrement() public {
        uint256 a = _createOrder();
        uint256 b = _createOrder();
        assertEq(a, 1);
        assertEq(b, 2);
        assertEq(core.totalOrders(), 2);
    }

    // -----------------------------------------------------------------------
    // Happy path: PASS
    // -----------------------------------------------------------------------

    function test_passLifecycle_paysOperatorAndUnlocksStake() public {
        uint256 orderId = _fundedAcceptedDelivered();
        uint256 opBefore = operator.balance;

        bytes memory sig = _signHonest(orderId, MetrxCore.Verdict.Pass, 9200);
        vm.prank(stranger);
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9200, REASON, uint64(block.timestamp), sig);

        MetrxCore.Order memory o = core.getOrder(orderId);
        assertEq(uint8(o.status), uint8(MetrxCore.OrderStatus.Paid));
        assertEq(uint8(o.verdict), uint8(MetrxCore.Verdict.Pass));
        assertEq(o.scoreBps, 9200);
        assertEq(o.verdictReasonHash, REASON);

        assertEq(operator.balance, opBefore + PRICE);
        MetrxCore.Operator memory op = core.getOperator(operator);
        assertEq(op.lockedStake, 0);
        assertEq(op.stake, STAKE);
        assertEq(op.slashed, 0);
        assertEq(address(core).balance, STAKE);
    }

    // -----------------------------------------------------------------------
    // Happy path: FAIL
    // -----------------------------------------------------------------------

    function test_failLifecycle_refundsBuyerAndSlashesOperator() public {
        uint256 orderId = _fundedAcceptedDelivered();
        uint256 buyerBefore = buyer.balance;

        bytes memory sig = _signHonest(orderId, MetrxCore.Verdict.Fail, 1500);
        vm.prank(stranger);
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Fail, 1500, REASON, uint64(block.timestamp), sig);

        MetrxCore.Order memory o = core.getOrder(orderId);
        assertEq(uint8(o.status), uint8(MetrxCore.OrderStatus.Slashed));
        assertEq(buyer.balance, buyerBefore + PRICE + MAX_SLASH);

        MetrxCore.Operator memory op = core.getOperator(operator);
        assertEq(op.lockedStake, 0);
        assertEq(op.stake, STAKE - MAX_SLASH);
        assertEq(op.slashed, MAX_SLASH);
        assertEq(address(core).balance, STAKE - MAX_SLASH);
    }

    // -----------------------------------------------------------------------
    // Signature rejection
    // -----------------------------------------------------------------------

    function test_fakeVerifierSignatureRejected() public {
        uint256 orderId = _fundedAcceptedDelivered();
        uint256 impostorPk = 0xBAD;
        bytes memory sig = _sign(impostorPk, _cert(orderId, MetrxCore.Verdict.Pass, 10_000));
        vm.expectRevert(
            abi.encodeWithSelector(MetrxCore.UnauthorizedVerifier.selector, vm.addr(impostorPk))
        );
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 10_000, REASON, uint64(block.timestamp), sig);
    }

    function test_signatureFromOtherOrderRejected() public {
        uint256 first = _fundedAcceptedDelivered();

        uint256 second = _createOrder();
        vm.prank(operator);
        core.acceptOrder(second);
        vm.prank(operator);
        core.submitDelivery(second, OUTPUT, ARTIFACT);

        bytes memory sigForFirst = _signHonest(first, MetrxCore.Verdict.Pass, 9000);
        vm.expectRevert();
        core.settleWithAIVerdict(second, MetrxCore.Verdict.Pass, 9000, REASON, uint64(block.timestamp), sigForFirst);
    }

    function test_signatureOverWrongOutputHashRejected() public {
        uint256 orderId = _fundedAcceptedDelivered();
        Cert memory c = _cert(orderId, MetrxCore.Verdict.Pass, 9000);
        c.outputHash = keccak256("different-output");
        bytes memory sig = _sign(VERIFIER_PK, c);
        vm.expectRevert();
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9000, REASON, uint64(block.timestamp), sig);
    }

    function test_signatureOverWrongRubricRejected() public {
        uint256 orderId = _fundedAcceptedDelivered();
        Cert memory c = _cert(orderId, MetrxCore.Verdict.Pass, 9000);
        c.rubricHash = keccak256("looser-rubric");
        bytes memory sig = _sign(VERIFIER_PK, c);
        vm.expectRevert();
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9000, REASON, uint64(block.timestamp), sig);
    }

    function test_signatureOverWrongModelRejected() public {
        uint256 orderId = _fundedAcceptedDelivered();
        Cert memory c = _cert(orderId, MetrxCore.Verdict.Pass, 9000);
        c.modelHash = keccak256("cheaper-model");
        bytes memory sig = _sign(VERIFIER_PK, c);
        vm.expectRevert();
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9000, REASON, uint64(block.timestamp), sig);
    }

    function test_mutatedScoreInvalidatesSignature() public {
        uint256 orderId = _fundedAcceptedDelivered();
        bytes memory sig = _signHonest(orderId, MetrxCore.Verdict.Pass, 9000);
        vm.expectRevert();
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9001, REASON, uint64(block.timestamp), sig);
    }

    function test_verdictNoneRejected() public {
        uint256 orderId = _fundedAcceptedDelivered();
        bytes memory sig = _signHonest(orderId, MetrxCore.Verdict.None, 0);
        vm.expectRevert(MetrxCore.BadVerdict.selector);
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.None, 0, REASON, uint64(block.timestamp), sig);
    }

    function test_scoreAboveMaxRejected() public {
        uint256 orderId = _fundedAcceptedDelivered();
        bytes memory sig = _signHonest(orderId, MetrxCore.Verdict.Pass, 10_001);
        vm.expectRevert(MetrxCore.ScoreOutOfRange.selector);
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 10_001, REASON, uint64(block.timestamp), sig);
    }

    function test_badSignatureLengthRejected() public {
        uint256 orderId = _fundedAcceptedDelivered();
        vm.expectRevert(MetrxCore.BadSignatureLength.selector);
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9000, REASON, uint64(block.timestamp), hex"1234");
    }

    function test_malleableSignatureRejected() public {
        uint256 orderId = _fundedAcceptedDelivered();
        bytes memory sig = _signHonest(orderId, MetrxCore.Verdict.Pass, 9000);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory flipped = abi.encodePacked(r, bytes32(n - uint256(s)), uint8(v == 27 ? 28 : 27));
        vm.expectRevert(MetrxCore.MalleableSignature.selector);
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9000, REASON, uint64(block.timestamp), flipped);
    }

    function test_evaluatedAtBeforeDeliveryRejected() public {
        uint256 orderId = _fundedAcceptedDelivered();
        uint64 stale = uint64(block.timestamp - 1);
        Cert memory c = _cert(orderId, MetrxCore.Verdict.Pass, 9000);
        c.evaluatedAt = stale;
        bytes memory sig = _sign(VERIFIER_PK, c);
        vm.expectRevert(MetrxCore.EvaluatedAtOutOfRange.selector);
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9000, REASON, stale, sig);
    }

    function test_evaluatedAtFarInFutureRejected() public {
        uint256 orderId = _fundedAcceptedDelivered();
        uint64 future = uint64(block.timestamp + 16 minutes);
        Cert memory c = _cert(orderId, MetrxCore.Verdict.Pass, 9000);
        c.evaluatedAt = future;
        bytes memory sig = _sign(VERIFIER_PK, c);
        vm.expectRevert(MetrxCore.EvaluatedAtOutOfRange.selector);
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9000, REASON, future, sig);
    }

    // -----------------------------------------------------------------------
    // State machine guards
    // -----------------------------------------------------------------------

    function test_verdictBeforeDeliveryRejected() public {
        _registerOperator();
        uint256 orderId = _createOrder();
        vm.prank(operator);
        core.acceptOrder(orderId);

        Cert memory c = _cert(orderId, MetrxCore.Verdict.Pass, 9000);
        c.outputHash = bytes32(0);
        bytes memory sig = _sign(VERIFIER_PK, c);
        vm.expectRevert(
            abi.encodeWithSelector(
                MetrxCore.WrongStatus.selector, MetrxCore.OrderStatus.Delivered, MetrxCore.OrderStatus.Accepted
            )
        );
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9000, REASON, uint64(block.timestamp), sig);
    }

    function test_doubleSettlementRejected() public {
        uint256 orderId = _fundedAcceptedDelivered();
        bytes memory sig = _signHonest(orderId, MetrxCore.Verdict.Pass, 9000);
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9000, REASON, uint64(block.timestamp), sig);

        vm.expectRevert(
            abi.encodeWithSelector(
                MetrxCore.WrongStatus.selector, MetrxCore.OrderStatus.Delivered, MetrxCore.OrderStatus.Paid
            )
        );
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9000, REASON, uint64(block.timestamp), sig);
    }

    function test_terminalStateCannotChange() public {
        uint256 orderId = _fundedAcceptedDelivered();
        bytes memory sig = _signHonest(orderId, MetrxCore.Verdict.Pass, 9000);
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9000, REASON, uint64(block.timestamp), sig);

        vm.warp(block.timestamp + 10 hours);
        vm.expectRevert();
        core.finalizeUndelivered(orderId);
        vm.expectRevert();
        core.finalizeVerifierTimeout(orderId);
        vm.prank(buyer);
        vm.expectRevert();
        core.cancelOrder(orderId);
    }

    function test_lateDeliveryRejected() public {
        _registerOperator();
        uint256 orderId = _createOrder();
        vm.prank(operator);
        core.acceptOrder(orderId);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(operator);
        vm.expectRevert(MetrxCore.DeliveryWindowClosed.selector);
        core.submitDelivery(orderId, OUTPUT, ARTIFACT);
    }

    function test_acceptAfterDeliveryDeadlineRejected() public {
        _registerOperator();
        uint256 orderId = _createOrder();
        vm.warp(block.timestamp + 2 hours);
        vm.prank(operator);
        vm.expectRevert(MetrxCore.DeliveryWindowClosed.selector);
        core.acceptOrder(orderId);
    }

    function test_onlyAssignedOperatorCanDeliver() public {
        uint256 orderId = _fundedAcceptedDelivered();
        assertEq(uint8(core.getOrder(orderId).status), uint8(MetrxCore.OrderStatus.Delivered));

        uint256 second = _createOrder();
        vm.prank(operator);
        core.acceptOrder(second);
        vm.prank(stranger);
        vm.expectRevert(MetrxCore.NotAssignedOperator.selector);
        core.submitDelivery(second, OUTPUT, ARTIFACT);
    }

    function test_buyerCanCancelOnlyBeforeAccept() public {
        _registerOperator();
        uint256 orderId = _createOrder();

        vm.prank(stranger);
        vm.expectRevert(MetrxCore.NotBuyer.selector);
        core.cancelOrder(orderId);

        uint256 before = buyer.balance;
        vm.prank(buyer);
        core.cancelOrder(orderId);
        assertEq(buyer.balance, before + PRICE);
        assertEq(uint8(core.getOrder(orderId).status), uint8(MetrxCore.OrderStatus.Cancelled));

        uint256 second = _createOrder();
        vm.prank(operator);
        core.acceptOrder(second);
        vm.prank(buyer);
        vm.expectRevert();
        core.cancelOrder(second);
    }

    function test_unknownOrderRejected() public {
        vm.expectRevert(MetrxCore.UnknownOrder.selector);
        core.acceptOrder(999);
    }

    // -----------------------------------------------------------------------
    // Deadline finalisation
    // -----------------------------------------------------------------------

    function test_undeliveredAcceptedOrder_refundsAndSlashes() public {
        _registerOperator();
        uint256 orderId = _createOrder();
        vm.prank(operator);
        core.acceptOrder(orderId);

        vm.expectRevert(MetrxCore.DeadlineNotReached.selector);
        core.finalizeUndelivered(orderId);

        uint256 buyerBefore = buyer.balance;
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(stranger);
        core.finalizeUndelivered(orderId);

        assertEq(buyer.balance, buyerBefore + PRICE + MAX_SLASH);
        assertEq(uint8(core.getOrder(orderId).status), uint8(MetrxCore.OrderStatus.Slashed));

        MetrxCore.Operator memory op = core.getOperator(operator);
        assertEq(op.stake, STAKE - MAX_SLASH);
        assertEq(op.lockedStake, 0);
        assertEq(op.slashed, MAX_SLASH);
    }

    function test_unacceptedOrderPastDeadline_refundsOnly() public {
        uint256 orderId = _createOrder();
        uint256 buyerBefore = buyer.balance;
        vm.warp(block.timestamp + 1 hours + 1);
        core.finalizeUndelivered(orderId);

        assertEq(buyer.balance, buyerBefore + PRICE);
        assertEq(uint8(core.getOrder(orderId).status), uint8(MetrxCore.OrderStatus.Refunded));
        assertEq(address(core).balance, 0);
    }

    function test_verifierTimeout_refundsBuyerAndReleasesStake() public {
        uint256 orderId = _fundedAcceptedDelivered();

        vm.expectRevert(MetrxCore.VerificationWindowOpen.selector);
        core.finalizeVerifierTimeout(orderId);

        uint256 buyerBefore = buyer.balance;
        vm.warp(block.timestamp + 3 hours);
        vm.prank(stranger);
        core.finalizeVerifierTimeout(orderId);

        assertEq(buyer.balance, buyerBefore + PRICE);
        assertEq(uint8(core.getOrder(orderId).status), uint8(MetrxCore.OrderStatus.Refunded));

        MetrxCore.Operator memory op = core.getOperator(operator);
        assertEq(op.stake, STAKE);
        assertEq(op.lockedStake, 0);
        assertEq(op.slashed, 0);
    }

    function test_settlementAfterVerificationDeadlineRejected() public {
        uint256 orderId = _fundedAcceptedDelivered();
        uint64 evaluatedAt = uint64(block.timestamp);
        bytes memory sig = _signHonest(orderId, MetrxCore.Verdict.Pass, 9000);

        vm.warp(block.timestamp + 3 hours);
        vm.expectRevert(MetrxCore.VerificationWindowClosed.selector);
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 9000, REASON, evaluatedAt, sig);
    }

    // -----------------------------------------------------------------------
    // Escrow safety
    // -----------------------------------------------------------------------

    function test_rejectingBuyerGetsDeferredCredit() public {
        RejectingRecipient hostile = new RejectingRecipient();
        vm.deal(address(hostile), 10 ether);

        (uint64 d, uint64 v) = _deadlines();
        vm.prank(address(hostile));
        uint256 orderId = core.createOrder{value: PRICE}(JOB_SPEC, INPUT, RUBRIC, MODEL, d, v, MAX_SLASH);

        vm.warp(block.timestamp + 1 hours + 1);
        core.finalizeUndelivered(orderId);

        assertEq(core.withdrawable(address(hostile)), PRICE);
        assertEq(address(core).balance, PRICE);
    }

    function test_reentrantBuyerCannotDoubleSettle() public {
        ReentrantBuyer attacker = new ReentrantBuyer();
        vm.deal(address(attacker), 10 ether);
        _registerOperator();

        (uint64 d, uint64 v) = _deadlines();
        uint256 orderId =
            attacker.create{value: PRICE}(core, JOB_SPEC, INPUT, RUBRIC, MODEL, d, v, MAX_SLASH);
        attacker.arm(core, orderId);

        vm.prank(operator);
        core.acceptOrder(orderId);
        vm.prank(operator);
        core.submitDelivery(orderId, OUTPUT, ARTIFACT);

        vm.warp(block.timestamp + 3 hours);
        core.finalizeVerifierTimeout(orderId);

        assertEq(uint8(core.getOrder(orderId).status), uint8(MetrxCore.OrderStatus.Refunded));
        assertEq(address(core).balance, STAKE);
    }

    function test_payAndRefundAreMutuallyExclusive() public {
        uint256 orderId = _fundedAcceptedDelivered();
        uint256 buyerBefore = buyer.balance;
        uint256 opBefore = operator.balance;

        bytes memory sig = _signHonest(orderId, MetrxCore.Verdict.Pass, 8800);
        core.settleWithAIVerdict(orderId, MetrxCore.Verdict.Pass, 8800, REASON, uint64(block.timestamp), sig);

        assertEq(operator.balance, opBefore + PRICE);
        assertEq(buyer.balance, buyerBefore);
    }

    function test_escrowIsConserved_acrossMixedOutcomes() public {
        _registerOperator();
        uint256 opening = address(core).balance;

        uint256 paid = _createOrder();
        vm.prank(operator);
        core.acceptOrder(paid);
        vm.prank(operator);
        core.submitDelivery(paid, OUTPUT, ARTIFACT);
        bytes memory passSig = _signHonest(paid, MetrxCore.Verdict.Pass, 9500);
        core.settleWithAIVerdict(paid, MetrxCore.Verdict.Pass, 9500, REASON, uint64(block.timestamp), passSig);

        uint256 slashed = _createOrder();
        vm.prank(operator);
        core.acceptOrder(slashed);
        vm.prank(operator);
        core.submitDelivery(slashed, OUTPUT, ARTIFACT);
        bytes memory failSig = _signHonest(slashed, MetrxCore.Verdict.Fail, 2000);
        core.settleWithAIVerdict(slashed, MetrxCore.Verdict.Fail, 2000, REASON, uint64(block.timestamp), failSig);

        uint256 cancelled = _createOrder();
        vm.prank(buyer);
        core.cancelOrder(cancelled);

        MetrxCore.Operator memory op = core.getOperator(operator);
        assertEq(op.lockedStake, 0);
        assertEq(address(core).balance, opening - MAX_SLASH);
        assertEq(address(core).balance, op.stake);
    }

    function test_domainSeparatorMatchesSpec() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Metrx"),
                keccak256("1"),
                block.chainid,
                address(core)
            )
        );
        assertEq(core.domainSeparator(), expected);
    }

    function test_aiVerdictDigestViewMatchesSignedDigest() public {
        uint256 orderId = _fundedAcceptedDelivered();
        uint64 evaluatedAt = uint64(block.timestamp);
        bytes32 structHash = keccak256(
            abi.encode(
                core.AI_VERDICT_TYPEHASH(),
                orderId,
                JOB_SPEC,
                INPUT,
                RUBRIC,
                MODEL,
                OUTPUT,
                uint8(MetrxCore.Verdict.Pass),
                uint16(9000),
                REASON,
                evaluatedAt
            )
        );
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", core.domainSeparator(), structHash));
        assertEq(core.aiVerdictDigest(orderId, MetrxCore.Verdict.Pass, 9000, REASON, evaluatedAt), expected);
    }
}
