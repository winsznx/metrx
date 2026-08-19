# Security

MetrxCore has no owner, no admin, no upgrade path, and no pause. What it does at deploy time
is what it does forever. That makes the trust model short enough to state completely.

## The one trusted party

The contract takes an `aiVerifier` address at construction and stores it as `immutable`. That
address is the only signature the contract will accept for a PAY or SLASH outcome. Everything
else is permissionless: anyone can create an order, anyone can register as an operator, and
anyone holding a valid certificate can submit it.

**If the verifier key is compromised**, an attacker can settle any *already delivered* order
in either direction. It cannot:

- mint value or withdraw escrow to itself,
- touch an order that has not reached `Delivered`,
- move an operator's unlocked stake,
- slash more than the `maxSlash` locked for that specific order,
- re-settle an order that already reached a terminal state.

The blast radius is bounded to the outcome of orders in flight. There is no key rotation in
v1; a compromise means deploying a new contract.

## What the contract enforces

### Certificate binding

`settleWithAIVerdict` rebuilds the EIP-712 struct hash from **contract storage**, not from
caller-supplied arguments:

```solidity
bytes32 digest = _hashTypedData(keccak256(abi.encode(
    AI_VERDICT_TYPEHASH, orderId,
    o.jobSpecHash, o.inputHash, o.rubricHash, o.modelHash, o.outputHash,
    uint8(verdict), scoreBps, reasonHash, evaluatedAt
)));
```

A certificate covering a different order id, spec, rubric, model, or output produces a
different digest and therefore recovers a different address. Tests cover each of these
mutations individually (`test_signatureOverWrongRubricRejected`, `…WrongModel…`,
`…WrongOutputHash…`, `test_signatureFromOtherOrderRejected`).

### Replay protection

Settlement requires `status == Delivered`, and settlement makes the status terminal. A second
submission of the same certificate reverts on state before signature recovery is reached
(`test_doubleSettlementRejected`, `test_terminalStateCannotChange`).

### Signature hygiene

Signatures must be exactly 65 bytes with `s` in the lower half of the curve order. The
malleable counterpart of a valid signature is rejected explicitly rather than silently
accepted (`test_malleableSignatureRejected`). `ecrecover` returning the zero address surfaces
as `UnauthorizedVerifier(0x0)`.

### Escrow conservation

Every terminal path assigns the full escrow to exactly one party, and pay and refund are
mutually exclusive in every transition. `SettlementMath` is a pure library so the arithmetic
can be property-tested in isolation, and the reference model asserts the same invariant with
`conserves()`. Fuzz tests over price, max slash, and stake confirm that:

- PASS moves exactly `price` to the operator and leaves stake untouched,
- FAIL moves exactly `price + maxSlash` to the buyer,
- `slashed + unlocked == lockedStake` in every branch.

### Bounded slashing

`slashed = min(maxSlash, lockedStake)`, so a slash can never exceed what was locked for that
order. Locked stake cannot be withdrawn: `withdrawUnlockedStake` checks against
`stake - lockedStake` (`test_operatorCannotWithdrawLockedStake`).

### Timestamp sanity

A certificate is rejected if `evaluatedAt` is before the delivery it claims to judge, or more
than `MAX_CLOCK_SKEW` (15 minutes) in the future. That stops a pre-signed certificate for an
output that did not exist yet.

### Reentrancy

Every value-moving entry point holds a lock, and all storage is final before any external
call. The test suite includes a buyer contract that attempts to re-enter settlement from its
`receive()` hook (`test_reentrantBuyerCannotDoubleSettle`).

### No stranded escrow

Payouts are pushed with a 60,000 gas stipend. If the call fails — a contract wallet with an
expensive hook, a recipient that reverts — the amount is credited to `withdrawable` and can be
pulled with `withdraw()`. This is why a hostile buyer cannot brick an operator's payout by
reverting on receipt (`test_rejectingBuyerGetsDeferredCredit`).

### Deadline behaviour

The two windows do not overlap:

- `settleWithAIVerdict` requires `block.timestamp <= verificationDeadline`
- `finalizeVerifierTimeout` requires `block.timestamp > verificationDeadline`

Exactly one is valid at any instant, so there is no race in which a buyer front-runs a passing
certificate with a timeout refund. Deadlines are also capped at 30 days from creation, so
escrow cannot be parked indefinitely.

Timestamp comparisons are on the scale of minutes to days, well outside the range a validator
could meaningfully manipulate.

## What is not enforced

**The verdict itself.** The contract checks who signed, not whether the judgement was right.
A badly prompted or compromised verifier can pay a bad output or fail a good one. What Metrx
provides is that the rubric was fixed before the work started, the output was fixed before it
was judged, and the reasoning is published under a hash the settlement transaction carries.
Disagreement is possible because the evidence is public.

**Artifact availability.** Hashes are on-chain; bytes are not. Tampering is detectable, but
nothing on-chain guarantees the artifact stays hosted.

**Compute provenance.** Nothing proves the operator ran any particular hardware, model, or
computation. The output is judged as text against a rubric.

## Off-chain hardening

The verifier service refuses to sign rather than guess:

- a model response that is not parseable JSON,
- a verdict outside `{PASS, FAIL}` or a score outside `0..10000`,
- a reason under 20 characters,
- a `PASS` that also marks a rubric item unsatisfied (internally inconsistent),
- an order whose `modelHash` does not match the model this worker actually runs,
- published artifacts that do not reproduce the on-chain hashes,
- a provider rate limit whose reset is further out than a short wait.

Each of these returns an error and settles nothing. The signing key lives in a Worker secret
and never appears in a response.

The default model, `openai/gpt-oss-120b` on Groq, is asked for its verdict under a strict
`json_schema`, so the verdict shape is enforced by the model itself. That narrows the attack
surface to the content of the judgement rather than its form. The validator above still runs
on every response, because a well-formed verdict can still be self-contradictory.

## Known limitations

- **Single verifier, no appeal.** One address decides. There is no dispute round in v1.
- **Impossible rubrics.** A buyer can write a rubric no output can satisfy. The rubric is
  public and hash-committed before an operator accepts, so the defence is that operators read
  it and decline.
- **Griefing on verifier timeout.** An operator that delivers but never gets a certificate
  submitted loses the sale, though not its stake. Mitigated by letting anyone, including the
  operator, run the verifier and submit.
- **Unaudited.** The contract is small, has no admin surface, and is covered by 52 Foundry
  tests plus an independent reference model, but it has not had a third-party audit.

## Operator exit

`setOperatorActive(false)` stops an operator receiving new work. It blocks `acceptOrder` and
nothing else: orders already accepted continue, and stake locked against them stays locked until
those orders settle. There is deliberately no way to abandon in-flight work, because the buyer's
escrow depends on it.

## Denial of settlement

Model calls run on one shared provider key, so an open verifier endpoint is an availability risk
for every user rather than only a cost problem. Three things bound it:

- A signed certificate is cached against the committed output hash, so repeat requests for the
  same order never spend quota and always return the identical signature.
- `POST /api/verify/:orderId` and `POST /api/preview` are rate limited per IP.
- The certificate is also recoverable from the settlement transaction's calldata, so losing the
  cache never loses the evidence.

If the verifier is unreachable for an entire verification window, the order still resolves: the
buyer is refunded and the operator's stake is released. The operator loses the sale, which is why
both the create wizard and the operator console state that consequence before the fact.

## Reporting

Open an issue on the repository. Since the contract has no upgrade path, a fix means a new
deployment at a new address, and the claim ledger is updated to point at it.
