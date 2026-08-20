# What is real

A plain account of what Metrx does today. Nothing here is aspirational, and the status column
is updated only when there is a transaction hash behind it.

Last updated: 2026-08-19.

## Built and tested

| Thing | Status |
| --- | --- |
| `MetrxCore.sol` — native BOT escrow, operator staking, EIP-712 verdict settlement | Written, compiles under solc 0.8.28 |
| Foundry test suite — 46 unit/integration + 6 fuzz properties | 52/52 passing |
| TypeScript reference model of the same settlement rules | 53/53 passing |
| AI verifier service — groq (default), anthropic, openai, workers-ai, mock | 10 provider tests passing |
| Schema-enforced verdicts via Groq strict `json_schema` on `openai/gpt-oss-120b` | Request shape and refusal paths tested |
| Cross-language EIP-712 parity (TS signer vs Solidity recovery) | Verified against compiled bytecode on anvil |
| Full product loop through the real API routes (fund → deliver → verify → settle → proof) | Verified on anvil, PAY and SLASH |
| Web app — landing, onboarding checklist, buyer wizard, operator console, verifier surface, settings, proof pages | Builds, typechecks |
| Live BOT Chain seam check | 12/12 passing, see [SEAM_REPORT.md](SEAM_REPORT.md) |
| Web app deployed | Live at https://metrx.pages.dev |
| Verifier service deployed with durable KV artifact storage | Live at https://metrx-api.timjosh507.workers.dev |

## Live on BOT Chain Mainnet

| Thing | Evidence |
| --- | --- |
| `MetrxCore` deployed to chain 677 | [`0x8b607937eE86Bfc9de57F5d2F8E9d02F58415532`](https://scan.botchain.ai/address/0x8b607937eE86Bfc9de57F5d2F8E9d02F58415532), deployed at block 20153854 |
| Source verified on BOTScan | [Verified via Blockscout](https://scan.botchain.ai/address/0x8b607937eE86Bfc9de57F5d2F8E9d02F58415532#code), solc 0.8.28, optimizer 200 runs |
| Completed PAY lifecycle | Order #2 → `Paid`. Groq `openai/gpt-oss-120b` returned PASS at 100%; [settlement tx](https://scan.botchain.ai/tx/0x6af63304339ba08b75f7c89f3405946573955943d81a363fcd03ccf980617fb2) |
| Completed SLASH lifecycle | Order #3 → `Slashed`. The same model returned FAIL at 0% with all three rubric items unmet; [settlement tx](https://scan.botchain.ai/tx/0x4e4bab0afb4013bd8524c1486ab3ae37aa2edb82ffa5f163bfa60db924d46a72) |
| A second PAY lifecycle | Order #1 → `Paid`, settled from the app's own verifier surface; [settlement tx](https://scan.botchain.ai/tx/0x0ae2979524aa9f4a901be5e7accd593c02a3604b0bc37d346032d6ac1243132d) |
| Verdicts came from a real model, not the mock | `PROOF_RUNS.json` records `provider: groq`, `mocked: false` |
| Every published artifact still reproduces its on-chain hash | `/api/proof/2` and `/api/proof/3` both report 7/7 hash checks matching |
| Every settlement is reachable from the UI | `/proof/:id` renders the full transaction trail, rebuilt from event logs |
| The signed certificate is public for every settled order | Recovered from the settlement transaction's calldata, so it exists even for orders this service never signed |
| A buyer can see the supply side before funding | `/api/operators` reports registered operators and the largest unlocked stake, surfaced on the Terms step |
| A rubric can be tested before any money moves | `/api/preview` runs the real verifier with no order, no chain write and no signature |

`pnpm claim:verify` re-reads all of this from chain.

## Not yet done

| Thing | Status |
| --- | --- |
| Demo video | Script written in [DEMO.md](DEMO.md), not yet recorded |

## What is real about the mechanism

- **Escrow and stake are native BOT.** No USDT, no wrapped token, no mock token, no ERC-20
  approval anywhere in the flow.
- **The AI verifier signs real EIP-712 certificates.** The contract will only settle a PAY or
  SLASH against a signature that recovers to the address named at deploy time. A certificate
  signed by any other key reverts.
- **Certificates are bound to one order.** The signed digest is rebuilt from on-chain state,
  so a certificate cannot be moved to another order, a looser rubric, a cheaper model, or a
  different output.
- **Job specs, rubrics, outputs, and verifier reasoning are public**, content-addressed by
  exactly the keccak hash the contract stores. Anyone can re-derive them.
- **Deadlines resolve every order without cooperation.** Undelivered refunds the buyer and
  slashes the operator. Delivered with no verdict refunds the buyer and releases the stake.
- **The rules are specified twice.** Foundry tests the contract; an independent TypeScript
  model tests the same rules written from the spec. A disagreement is a bug report.

## What is trusted, not proven

The AI verifier's judgement is the trust boundary. The contract enforces its signature; it
cannot check whether the judgement was correct. A compromised or badly prompted verifier can
pay a bad output or fail a good one.

What Metrx buys is that the judgement is public and bounded. The rubric was committed before
the work started, the output was committed before it was judged, and the reasoning is
published under a hash the settlement transaction carries.

The honest claim is: **publicly auditable AI adjudication, enforced by BOT Chain settlement.**

## What Metrx does not claim

- **Not generalized trustless compute.** Nothing here proves arbitrary computation ran.
- **Not private compute.** Inputs and outputs are published so the verdict can be audited.
- **Not tokenized GPU ownership**, compute receivables, or any RWA financial instrument.
- **Not a decentralized verifier set.** Exactly one verifier address, fixed at deploy.
- **Not a marketplace.** No reputation, discovery, pricing, or matching engine.
- **No paymaster, bundler, or account abstraction.** Every write is a plain EOA transaction.
- **No TEE, no ZK, no re-execution.** These are the honest next steps, not shipped features.

## On mock mode

The verifier ships with a deterministic local stand-in behind `AI_PROVIDER=mock` so the full
lifecycle can be exercised offline and in CI. It applies crude keyword coverage per rubric
item — useful for testing the plumbing, useless as a judgement.

Every mocked verdict is tagged `mocked: true` in the API response, labelled in the verifier
UI, and flagged by `pnpm claim:verify`, which fails if any recorded mainnet proof run was
signed in mock mode. The mainnet proofs are intended to use a real provider; whichever one
signed them is recorded in `PROOF_RUNS.json`.

## Where the numbers come from

- 52 contract tests: `pnpm contracts:test`
- 53 reference model tests: `cd packages/reference && pnpm test`
- 27 worker tests (17 end-to-end + 10 Groq provider): `cd workers/api && pnpm test`
- Chain facts: `pnpm seam:check`, which rewrites [SEAM_REPORT.md](SEAM_REPORT.md) from live RPC
- Claim status: `pnpm claim:verify`, which re-reads every claim from BOT Chain
