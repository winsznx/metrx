// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SettlementMath} from "./SettlementMath.sol";

/// @title MetrxCore
/// @notice Native-BOT escrow and stake settlement for bounded AI compute jobs on BOT Chain.
///
/// Lifecycle:
///   buyer funds an order -> operator stakes and accepts -> operator submits delivery hashes
///   -> the AI verifier signs an EIP-712 AIVerdict -> the contract enforces PAY, REFUND or SLASH.
///
/// Trust boundary: the AI verifier address named at construction is the sole adjudicator.
/// The contract enforces its signed verdict; it does not evaluate compute itself.
/// See SECURITY.md for the full threat model.
contract MetrxCore {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    enum OrderStatus {
        None,
        Funded,
        Accepted,
        Delivered,
        Paid,
        Refunded,
        Slashed,
        Cancelled
    }

    enum Verdict {
        None,
        Pass,
        Fail
    }

    struct Operator {
        address owner;
        uint256 stake;
        uint256 lockedStake;
        uint256 slashed;
        bool active;
        string metadataURI;
    }

    struct Order {
        address buyer;
        address operator;
        uint256 price;
        uint256 maxSlash;
        uint64 createdAt;
        uint64 acceptedAt;
        uint64 deliveryDeadline;
        uint64 verificationDeadline;
        bytes32 jobSpecHash;
        bytes32 inputHash;
        bytes32 rubricHash;
        bytes32 modelHash;
        bytes32 outputHash;
        bytes32 deliveryArtifactHash;
        bytes32 verdictReasonHash;
        uint16 scoreBps;
        Verdict verdict;
        OrderStatus status;
        uint64 deliveredAt;
        uint64 evaluatedAt;
        uint64 settledAt;
    }

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    /// @notice Floor for operator registration so every operator carries real exposure.
    uint256 public constant MIN_STAKE = 0.001 ether;
    /// @notice Upper bound on how far a deadline may sit in the future, so escrow cannot be parked forever.
    uint64 public constant MAX_DEADLINE_HORIZON = 30 days;
    /// @notice Scores are basis points of rubric satisfaction.
    uint16 public constant MAX_SCORE_BPS = 10_000;
    /// @notice Tolerance for the verifier's own clock running ahead of the chain.
    uint64 public constant MAX_CLOCK_SKEW = 15 minutes;
    /// @notice Gas forwarded to a payout recipient before falling back to a pull-based credit.
    uint256 private constant PAYOUT_GAS = 60_000;

    bytes32 private constant _EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @notice EIP-712 struct hash for the AI verifier's settlement certificate.
    bytes32 public constant AI_VERDICT_TYPEHASH = keccak256(
        "AIVerdict(uint256 orderId,bytes32 jobSpecHash,bytes32 inputHash,bytes32 rubricHash,bytes32 modelHash,bytes32 outputHash,uint8 verdict,uint16 scoreBps,bytes32 reasonHash,uint64 evaluatedAt)"
    );

    bytes32 private constant _NAME_HASH = keccak256("Metrx");
    bytes32 private constant _VERSION_HASH = keccak256("1");

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    /// @notice The only address whose signature can settle an order as PAY or SLASH.
    address public immutable aiVerifier;

    uint256 private immutable _cachedChainId;
    bytes32 private immutable _cachedDomainSeparator;

    uint256 public nextOrderId = 1;

    mapping(uint256 => Order) private _orders;
    mapping(address => Operator) private _operators;

    /// @notice Funds credited to an address whose direct payout call failed. Pull with `withdraw()`.
    mapping(address => uint256) public withdrawable;

    uint256 private _reentrancyLock;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event OperatorRegistered(address indexed operator, uint256 stake, string metadataURI);
    event OperatorMetadataUpdated(address indexed operator, string metadataURI);
    event StakeAdded(address indexed operator, uint256 amount);
    event StakeWithdrawn(address indexed operator, uint256 amount);

    event OrderCreated(uint256 indexed orderId, address indexed buyer, uint256 price);
    event OrderCancelled(uint256 indexed orderId);
    event OrderAccepted(uint256 indexed orderId, address indexed operator);
    event DeliverySubmitted(uint256 indexed orderId, bytes32 outputHash, bytes32 deliveryArtifactHash);

    event AIVerdictSettled(
        uint256 indexed orderId, address indexed aiVerifier, Verdict verdict, uint16 scoreBps, bytes32 reasonHash
    );

    event OrderPaid(uint256 indexed orderId, address indexed operator, uint256 amount);
    event OrderRefunded(uint256 indexed orderId, address indexed buyer, uint256 amount);
    event OperatorSlashed(uint256 indexed orderId, address indexed operator, uint256 amount);
    event PayoutDeferred(address indexed recipient, uint256 amount);
    event Withdrawn(address indexed recipient, uint256 amount);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error ZeroAddress();
    error Reentrancy();
    error AlreadyRegistered();
    error NotRegistered();
    error StakeTooLow();
    error NothingToWithdraw();
    error InsufficientUnlockedStake();
    error PriceRequired();
    error MaxSlashRequired();
    error BadDeadlines();
    error DeadlineTooFar();
    error MissingJobHashes();
    error MissingOutputHash();
    error UnknownOrder();
    error WrongStatus(OrderStatus expected, OrderStatus actual);
    error NotBuyer();
    error NotAssignedOperator();
    error DeliveryWindowClosed();
    error VerificationWindowClosed();
    error VerificationWindowOpen();
    error DeadlineNotReached();
    error BadVerdict();
    error ScoreOutOfRange();
    error EvaluatedAtOutOfRange();
    error BadSignatureLength();
    error MalleableSignature();
    error UnauthorizedVerifier(address recovered);

    // -----------------------------------------------------------------------
    // Construction
    // -----------------------------------------------------------------------

    constructor(address aiVerifier_) {
        if (aiVerifier_ == address(0)) revert ZeroAddress();
        aiVerifier = aiVerifier_;
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
    }

    modifier nonReentrant() {
        if (_reentrancyLock == 1) revert Reentrancy();
        _reentrancyLock = 1;
        _;
        _reentrancyLock = 0;
    }

    // -----------------------------------------------------------------------
    // Operator registry
    // -----------------------------------------------------------------------

    /// @notice Register the caller as an operator and post the initial stake in native BOT.
    function registerOperator(string calldata metadataURI) external payable {
        Operator storage op = _operators[msg.sender];
        if (op.owner != address(0)) revert AlreadyRegistered();
        if (msg.value < MIN_STAKE) revert StakeTooLow();

        op.owner = msg.sender;
        op.stake = msg.value;
        op.active = true;
        op.metadataURI = metadataURI;

        emit OperatorRegistered(msg.sender, msg.value, metadataURI);
    }

    /// @notice Top up stake so more or larger orders can be accepted.
    function addStake() external payable {
        Operator storage op = _operators[msg.sender];
        if (op.owner == address(0)) revert NotRegistered();
        if (msg.value == 0) revert StakeTooLow();

        op.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value);
    }

    /// @notice Withdraw stake that is not locked against an in-flight order.
    function withdrawUnlockedStake(uint256 amount) external nonReentrant {
        Operator storage op = _operators[msg.sender];
        if (op.owner == address(0)) revert NotRegistered();
        if (amount == 0) revert NothingToWithdraw();
        if (amount > op.stake - op.lockedStake) revert InsufficientUnlockedStake();

        op.stake -= amount;
        emit StakeWithdrawn(msg.sender, amount);
        _payout(msg.sender, amount);
    }

    /// @notice Update the operator's public metadata pointer (name, endpoint, capabilities).
    function setOperatorMetadata(string calldata metadataURI) external {
        Operator storage op = _operators[msg.sender];
        if (op.owner == address(0)) revert NotRegistered();
        op.metadataURI = metadataURI;
        emit OperatorMetadataUpdated(msg.sender, metadataURI);
    }

    // -----------------------------------------------------------------------
    // Order lifecycle
    // -----------------------------------------------------------------------

    /// @notice Fund a compute order. `msg.value` is the price held in escrow.
    /// @param jobSpecHash keccak256 of the canonical job spec JSON.
    /// @param inputHash keccak256 of the job input payload.
    /// @param rubricHash keccak256 of the canonical rubric the AI verifier must apply.
    /// @param modelHash keccak256 of the verifier model identifier the buyer accepts.
    /// @param deliveryDeadline unix seconds by which the operator must deliver.
    /// @param verificationDeadline unix seconds by which a signed verdict must land.
    /// @param maxSlash operator stake that becomes slashable once the order is accepted.
    function createOrder(
        bytes32 jobSpecHash,
        bytes32 inputHash,
        bytes32 rubricHash,
        bytes32 modelHash,
        uint64 deliveryDeadline,
        uint64 verificationDeadline,
        uint256 maxSlash
    ) external payable returns (uint256 orderId) {
        if (msg.value == 0) revert PriceRequired();
        if (maxSlash == 0) revert MaxSlashRequired();
        if (jobSpecHash == bytes32(0) || rubricHash == bytes32(0) || modelHash == bytes32(0)) {
            revert MissingJobHashes();
        }
        if (deliveryDeadline <= block.timestamp || verificationDeadline <= deliveryDeadline) revert BadDeadlines();
        if (verificationDeadline > block.timestamp + MAX_DEADLINE_HORIZON) revert DeadlineTooFar();

        orderId = nextOrderId++;
        Order storage o = _orders[orderId];
        o.buyer = msg.sender;
        o.price = msg.value;
        o.maxSlash = maxSlash;
        o.createdAt = uint64(block.timestamp);
        o.deliveryDeadline = deliveryDeadline;
        o.verificationDeadline = verificationDeadline;
        o.jobSpecHash = jobSpecHash;
        o.inputHash = inputHash;
        o.rubricHash = rubricHash;
        o.modelHash = modelHash;
        o.status = OrderStatus.Funded;

        emit OrderCreated(orderId, msg.sender, msg.value);
    }

    /// @notice Buyer pulls a funded order back before any operator has committed to it.
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage o = _mustExist(orderId);
        if (o.status != OrderStatus.Funded) revert WrongStatus(OrderStatus.Funded, o.status);
        if (msg.sender != o.buyer) revert NotBuyer();

        SettlementMath.Payout memory p = SettlementMath.onCancelled(o.price);
        o.status = OrderStatus.Cancelled;
        o.settledAt = uint64(block.timestamp);

        emit OrderCancelled(orderId);
        emit OrderRefunded(orderId, o.buyer, p.toBuyer);
        _payout(o.buyer, p.toBuyer);
    }

    /// @notice Operator commits to an order, locking `maxSlash` of its unlocked stake.
    function acceptOrder(uint256 orderId) external {
        Order storage o = _mustExist(orderId);
        if (o.status != OrderStatus.Funded) revert WrongStatus(OrderStatus.Funded, o.status);
        if (block.timestamp >= o.deliveryDeadline) revert DeliveryWindowClosed();

        Operator storage op = _operators[msg.sender];
        if (op.owner == address(0) || !op.active) revert NotRegistered();
        if (op.stake - op.lockedStake < o.maxSlash) revert InsufficientUnlockedStake();

        op.lockedStake += o.maxSlash;
        o.operator = msg.sender;
        o.acceptedAt = uint64(block.timestamp);
        o.status = OrderStatus.Accepted;

        emit OrderAccepted(orderId, msg.sender);
    }

    /// @notice Operator commits the output hash and the artifact pointer hash on-chain.
    /// @dev Hashes are frozen here so the AI verifier's certificate can only bind to this exact output.
    function submitDelivery(uint256 orderId, bytes32 outputHash, bytes32 deliveryArtifactHash) external {
        Order storage o = _mustExist(orderId);
        if (o.status != OrderStatus.Accepted) revert WrongStatus(OrderStatus.Accepted, o.status);
        if (msg.sender != o.operator) revert NotAssignedOperator();
        if (block.timestamp > o.deliveryDeadline) revert DeliveryWindowClosed();
        if (outputHash == bytes32(0)) revert MissingOutputHash();

        o.outputHash = outputHash;
        o.deliveryArtifactHash = deliveryArtifactHash;
        o.deliveredAt = uint64(block.timestamp);
        o.status = OrderStatus.Delivered;

        emit DeliverySubmitted(orderId, outputHash, deliveryArtifactHash);
    }

    /// @notice Enforce the AI verifier's signed verdict. Callable by anyone holding the certificate.
    /// @dev The signed digest is rebuilt from on-chain order state, so a certificate covering a
    ///      different order, spec, rubric, model or output simply fails to recover the verifier.
    function settleWithAIVerdict(
        uint256 orderId,
        Verdict verdict,
        uint16 scoreBps,
        bytes32 reasonHash,
        uint64 evaluatedAt,
        bytes calldata signature
    ) external nonReentrant {
        Order storage o = _mustExist(orderId);
        if (o.status != OrderStatus.Delivered) revert WrongStatus(OrderStatus.Delivered, o.status);
        if (block.timestamp > o.verificationDeadline) revert VerificationWindowClosed();
        if (verdict == Verdict.None) revert BadVerdict();
        if (scoreBps > MAX_SCORE_BPS) revert ScoreOutOfRange();
        if (evaluatedAt > block.timestamp + MAX_CLOCK_SKEW || evaluatedAt < o.deliveredAt) {
            revert EvaluatedAtOutOfRange();
        }

        bytes32 digest = _hashTypedData(
            keccak256(
                abi.encode(
                    AI_VERDICT_TYPEHASH,
                    orderId,
                    o.jobSpecHash,
                    o.inputHash,
                    o.rubricHash,
                    o.modelHash,
                    o.outputHash,
                    uint8(verdict),
                    scoreBps,
                    reasonHash,
                    evaluatedAt
                )
            )
        );
        address recovered = _recover(digest, signature);
        if (recovered != aiVerifier) revert UnauthorizedVerifier(recovered);

        Operator storage op = _operators[o.operator];
        SettlementMath.Payout memory p = verdict == Verdict.Pass
            ? SettlementMath.onPass(o.price, o.maxSlash)
            : SettlementMath.onFail(o.price, o.maxSlash, o.maxSlash);

        o.verdict = verdict;
        o.scoreBps = scoreBps;
        o.verdictReasonHash = reasonHash;
        o.evaluatedAt = evaluatedAt;
        o.settledAt = uint64(block.timestamp);
        o.status = verdict == Verdict.Pass ? OrderStatus.Paid : OrderStatus.Slashed;

        emit AIVerdictSettled(orderId, aiVerifier, verdict, scoreBps, reasonHash);
        _applyPayout(orderId, o, op, p);
    }

    /// @notice Close an order whose delivery deadline passed with nothing delivered.
    /// @dev An accepted order slashes the operator; an order nobody accepted only refunds the buyer.
    function finalizeUndelivered(uint256 orderId) external nonReentrant {
        Order storage o = _mustExist(orderId);
        if (o.status != OrderStatus.Funded && o.status != OrderStatus.Accepted) {
            revert WrongStatus(OrderStatus.Accepted, o.status);
        }
        if (block.timestamp <= o.deliveryDeadline) revert DeadlineNotReached();

        bool wasAccepted = o.status == OrderStatus.Accepted;
        Operator storage op = _operators[o.operator];
        SettlementMath.Payout memory p = wasAccepted
            ? SettlementMath.onUndelivered(o.price, o.maxSlash, o.maxSlash)
            : SettlementMath.onUnaccepted(o.price);

        o.status = wasAccepted ? OrderStatus.Slashed : OrderStatus.Refunded;
        o.settledAt = uint64(block.timestamp);

        _applyPayout(orderId, o, op, p);
    }

    /// @notice Close a delivered order that never received a signed verdict in time.
    /// @dev Buyer is refunded and the operator's stake is released without penalty.
    function finalizeVerifierTimeout(uint256 orderId) external nonReentrant {
        Order storage o = _mustExist(orderId);
        if (o.status != OrderStatus.Delivered) revert WrongStatus(OrderStatus.Delivered, o.status);
        if (block.timestamp <= o.verificationDeadline) revert VerificationWindowOpen();

        Operator storage op = _operators[o.operator];
        SettlementMath.Payout memory p = SettlementMath.onVerifierTimeout(o.price, o.maxSlash);

        o.status = OrderStatus.Refunded;
        o.settledAt = uint64(block.timestamp);

        _applyPayout(orderId, o, op, p);
    }

    /// @notice Pull funds credited after a direct payout call failed.
    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "withdraw failed");
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return _orders[orderId];
    }

    function getOperator(address operator) external view returns (Operator memory) {
        return _operators[operator];
    }

    /// @notice Stake an operator can still commit to new orders.
    function availableStake(address operator) external view returns (uint256) {
        Operator storage op = _operators[operator];
        return op.stake - op.lockedStake;
    }

    function totalOrders() external view returns (uint256) {
        return nextOrderId - 1;
    }

    /// @notice EIP-712 domain separator for the AIVerdict certificate.
    function domainSeparator() public view returns (bytes32) {
        return block.chainid == _cachedChainId ? _cachedDomainSeparator : _buildDomainSeparator();
    }

    /// @notice Digest an AI verifier signs for `orderId`, rebuilt from live on-chain state.
    function aiVerdictDigest(uint256 orderId, Verdict verdict, uint16 scoreBps, bytes32 reasonHash, uint64 evaluatedAt)
        external
        view
        returns (bytes32)
    {
        Order storage o = _orders[orderId];
        return _hashTypedData(
            keccak256(
                abi.encode(
                    AI_VERDICT_TYPEHASH,
                    orderId,
                    o.jobSpecHash,
                    o.inputHash,
                    o.rubricHash,
                    o.modelHash,
                    o.outputHash,
                    uint8(verdict),
                    scoreBps,
                    reasonHash,
                    evaluatedAt
                )
            )
        );
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    function _mustExist(uint256 orderId) private view returns (Order storage o) {
        o = _orders[orderId];
        if (o.status == OrderStatus.None) revert UnknownOrder();
    }

    /// @dev Single exit point for value movement. Storage is already final when this runs.
    function _applyPayout(
        uint256 orderId,
        Order storage o,
        Operator storage op,
        SettlementMath.Payout memory p
    ) private {
        if (p.slashed != 0 || p.unlocked != 0) {
            op.lockedStake -= (p.slashed + p.unlocked);
        }
        if (p.slashed != 0) {
            op.stake -= p.slashed;
            op.slashed += p.slashed;
            emit OperatorSlashed(orderId, o.operator, p.slashed);
        }
        if (p.toOperator != 0) {
            emit OrderPaid(orderId, o.operator, p.toOperator);
            _payout(o.operator, p.toOperator);
        }
        if (p.toBuyer != 0) {
            emit OrderRefunded(orderId, o.buyer, p.toBuyer);
            _payout(o.buyer, p.toBuyer);
        }
    }

    /// @dev Bounded-gas push with a pull-based fallback so a reverting recipient cannot strand escrow.
    function _payout(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount, gas: PAYOUT_GAS}("");
        if (!ok) {
            withdrawable[to] += amount;
            emit PayoutDeferred(to, amount);
        }
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(_EIP712_DOMAIN_TYPEHASH, _NAME_HASH, _VERSION_HASH, block.chainid, address(this)));
    }

    function _hashTypedData(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) revert BadSignatureLength();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert MalleableSignature();
        }
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }
}
