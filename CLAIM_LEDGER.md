# Claim ledger

Every public claim Metrx makes, with the level of proof behind it. A claim is only marked
`Proven` when a command in this repository can re-derive it from live chain state.

Run `pnpm claim:verify` to re-check every falsifiable row against BOT Chain. It exits
non-zero if any claim outruns its evidence.

**Proof levels**

- `Proven` — verifiable from BOT Chain Mainnet right now
- `Tested` — covered by a test suite in this repository, not yet on mainnet
- `Designed` — implemented and typechecked, not yet exercised end to end
- `Pending` — blocked, with the blocker named

---

| Claim | Proof level | Network | Address / Tx | Evidence | Limitation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BOT Chain Mainnet is reachable, chain id 677, zero base fee, legacy gas pricing | Proven | Mainnet 677 | `https://rpc.botchain.ai` | `pnpm seam:check` → SEAM_REPORT.md | Gas price moves (20–50 gwei observed); the report is a snapshot | Live |
| Explorer API is reachable for source verification | Proven | Mainnet 677 | `https://scan.botchain.ai/api` | MetrxCore source verified through it | — | Live |
| Settlement contract enforces PAY / REFUND / SLASH from an EIP-712 verdict | Proven | Mainnet 677 | [`0x868ee0…5B018`](https://scan.botchain.ai/address/0x8b607937eE86Bfc9de57F5d2F8E9d02F58415532) | 52 Foundry tests plus three settled mainnet orders | Verdict correctness is trusted, not proven | Live |
| A certificate signed by any key other than the registered verifier is rejected | Tested | anvil | — | `testFuzz_onlyVerifierKeySettles`, `test_fakeVerifierSignatureRejected` | — | Ready |
| A certificate cannot be replayed onto another order | Tested | anvil | — | `testFuzz_certificateIsNotPortableAcrossOrders` | — | Ready |
| A certificate over a different rubric, model, or output is rejected | Tested | anvil | — | `test_signatureOverWrongRubric/Model/OutputHashRejected` | — | Ready |
| Escrow is conserved and pay/refund are mutually exclusive | Tested | anvil | — | `test_escrowIsConserved_acrossMixedOutcomes`, `testFuzz_pass/failConservesValue` | — | Ready |
| Slashing never exceeds the stake locked for that order | Tested | anvil | — | `testFuzz_slashNeverExceedsLockedStake` | — | Ready |
| Terminal states cannot change, and settlement cannot happen twice | Tested | anvil | — | `test_terminalStateCannotChange`, `test_doubleSettlementRejected` | — | Ready |
| Deadlines resolve every order without cooperation | Tested | anvil | — | `test_undeliveredAcceptedOrder_refundsAndSlashes`, `test_verifierTimeout_refundsBuyerAndReleasesStake` | — | Ready |
| Reentrancy cannot double-settle, and a reverting recipient cannot strand escrow | Tested | anvil | — | `test_reentrantBuyerCannotDoubleSettle`, `test_rejectingBuyerGetsDeferredCredit` | — | Ready |
| The TypeScript signer and the Solidity verifier agree on the digest | Tested | anvil | — | `workers/api/test/lifecycle.e2e.test.ts` against compiled bytecode | — | Ready |
| The full loop works through the real API routes: fund → deliver → verify → settle → proof | Proven | Mainnet 677 | orders #2 and #3 | `api.e2e.test.ts` on anvil plus two live mainnet lifecycles | Test run uses mock mode; mainnet used Groq | Live |
| The verifier refuses to sign on malformed output, self-contradiction, out-of-range score, model mismatch, missing key, or rate limit | Tested | — | — | 10 tests in `workers/api/test/groq.test.ts` | Refusal paths are stubbed; the happy path is proven by two mainnet settlements | Ready |
| Verdicts are schema-enforced by the model, not repaired after the fact | Proven | Mainnet 677 | orders #2 and #3 | Strict `json_schema` asserted in `groq.test.ts`; both mainnet verdicts returned schema-conformant | Only on `openai/gpt-oss-*`; other models fall back to `json_object` | Live |
| Published artifacts still reproduce their on-chain hashes after settlement | Proven | Mainnet 677 | `/api/proof/2`, `/api/proof/3` | 7/7 hash checks match on both orders | Artifact availability is not chain-guaranteed | Live |
| Independent reference model agrees with the contract's settlement rules | Tested | — | — | 53 tests, `packages/reference` | Agreement is asserted per-rule, not machine-checked cross-suite | Ready |
| Escrow and stake are native BOT, with no USDT or ERC-20 approval | Proven | — | — | No token address appears in `MetrxCore.sol` | — | Live |
| No paymaster, bundler, or account abstraction on any path | Proven | — | — | Every write is a plain EOA transaction | — | Live |
| MetrxCore is deployed to BOT Chain Mainnet | Proven | Mainnet 677 | [`0x868ee0…5B018`](https://scan.botchain.ai/address/0x8b607937eE86Bfc9de57F5d2F8E9d02F58415532) · [deploy tx](https://scan.botchain.ai/tx/0x9cb0c561e32601a3b2de2a976b25c92966945b59706daefcaf37064319ba38ee) | 10,521 bytes of code at block 20153854 | No admin, no upgrade path | Live |
| Source verified on BOTScan | Proven | Mainnet 677 | [#code](https://scan.botchain.ai/address/0x8b607937eE86Bfc9de57F5d2F8E9d02F58415532#code) | Blockscout reports `Pass - Verified`, solc 0.8.28, 200 runs | — | Live |
| One completed PAY lifecycle on mainnet | Proven | Mainnet 677 | [settle tx](https://scan.botchain.ai/tx/0x6af63304339ba08b75f7c89f3405946573955943d81a363fcd03ccf980617fb2) | Order #2 is `Paid`, 0.01 BOT to the operator, PASS at 100% | Single job, bounded text task | Live |
| One completed REFUND/SLASH lifecycle on mainnet | Proven | Mainnet 677 | [settle tx](https://scan.botchain.ai/tx/0x4e4bab0afb4013bd8524c1486ab3ae37aa2edb82ffa5f163bfa60db924d46a72) | Order #3 is `Slashed`, buyer got 0.015 BOT, FAIL at 0% on all 3 rubric items | Single job, bounded text task | Live |
| Mainnet proofs were signed by a real model, not the mock | Proven | Mainnet 677 | PROOF_RUNS.json | Both runs record `provider: groq`, `mocked: false`, `openai/gpt-oss-120b` | — | Live |
| Web app is publicly reachable and wired to the live contract | Proven | Cloudflare Pages | https://metrx.pages.dev | Proof hub reads the settled orders; every order list is a plain batched read, not multicall | — | Live |
| Verifier service is publicly reachable with durable artifact storage | Proven | Cloudflare Workers | https://metrx-api.timjosh507.workers.dev | `/api/config` reports `artifactStore: kv`, `canSign: true`, `signerMatchesContract: true`, `schemaEnforced: true` | Single instance, single key | Live |

| Operators have a working exit | Proven | Mainnet 677 | `setOperatorActive(bool)` | Blocks `acceptOrder` while leaving live orders and locked stake untouched; 2 tests | Locked stake still releases only when those orders settle | Live |
| Every settlement is reachable from the UI | Proven | Mainnet 677 | `/proof/2`, `/proof/3` | Transaction trail rebuilt from event logs, each step linked to BOTScan | Needs the log index; the contract cannot store its own tx hash | Live |

---

## Claims Metrx deliberately does not make

| Non-claim | Why |
| --- | --- |
| Trustless verification of arbitrary compute | The verifier is a trusted signer, not a proof system |
| Private compute | Inputs and outputs are published so the verdict can be audited |
| Tokenized GPU ownership or compute receivables | No financial instrument exists in v1 |
| Decentralized verifier set or dispute resolution | Exactly one verifier address, fixed at deploy, no appeal |
| Audited contract | Tested and minimal, but not third-party audited |
| Operator reputation, discovery, or pricing | No marketplace layer exists |

## How to falsify any row

```bash
pnpm seam:check      # chain facts
pnpm contracts:test  # every Tested row in the contract
pnpm test            # reference model + full-loop rows
pnpm claim:verify    # every Proven / Pending row, re-read from BOT Chain
```
