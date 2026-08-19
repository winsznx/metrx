# Metrx

Compute delivery should settle, not depend on trust.

Metrx is an AI-native settlement layer on BOT Chain Mainnet. A buyer funds a compute job, an operator delivers output, and an AI verifier signs a public verdict that the contract enforces as PAY, REFUND, or SLASH.

| | |
| --- | --- |
| Live app | https://metrx.pages.dev |
| Verifier API | https://metrx-api.timjosh507.workers.dev |
| Demo video | _pending_ |
| Network | BOT Chain Mainnet, Chain ID 677 |
| Contract | [`0x8b607937eE86Bfc9de57F5d2F8E9d02F58415532`](https://scan.botchain.ai/address/0x8b607937eE86Bfc9de57F5d2F8E9d02F58415532#code) — source verified on BOTScan |
| AI verifier | [`0x10053A1406C7024Fd237fe4192BC15A0Bc018C8d`](https://scan.botchain.ai/address/0x10053A1406C7024Fd237fe4192BC15A0Bc018C8d) — `openai/gpt-oss-120b` via Groq |
| Completed PAY order | [order #2](https://metrx.pages.dev/proof/2) · [settlement tx](https://scan.botchain.ai/tx/0x6af63304339ba08b75f7c89f3405946573955943d81a363fcd03ccf980617fb2) — PASS at 100%, operator paid |
| Completed REFUND/SLASH order | [order #3](https://metrx.pages.dev/proof/3) · [settlement tx](https://scan.botchain.ai/tx/0x4e4bab0afb4013bd8524c1486ab3ae37aa2edb82ffa5f163bfa60db924d46a72) — FAIL at 0%, buyer refunded, operator slashed |
| Fastest proof path | Open [/proof](https://metrx.pages.dev/proof), click the PAY card, read the AI verdict, the signed EIP-712 certificate, and the transaction trail linking every step to BOTScan |

Honest status: v1 proves publicly auditable AI adjudication for bounded compute jobs. It does not claim generalized trustless compute, private compute, or tokenized GPU ownership. See [WHAT_IS_REAL.md](WHAT_IS_REAL.md).

`pnpm claim:verify` re-reads every claim above from BOT Chain and currently reports **9/9 verified**.

No wallet is needed to read any of it. If you want to try the mechanism without spending anything,
the rubric preview on [/app/create](https://metrx.pages.dev/app/create) runs the real verifier
against a sample output with no order and no signature.

---

## The mechanism

```
buyer funds compute order in native BOT
  → operator stakes and delivers output
    → AI verifier evaluates output against the public rubric
      → BOT Chain Mainnet settles PAY, REFUND, or SLASH
```

The AI verifier is not a chatbot bolted onto a product. It is a settlement participant: it reads the job spec, the buyer's rubric, and the operator's committed output, then signs an EIP-712 certificate. The contract recovers that signature and moves the money. Nothing else can.

What makes the verdict auditable rather than a black box:

- The rubric is hashed on-chain **before** any operator accepts the job.
- The output is hashed on-chain **before** the verifier sees it.
- The verifier's full reasoning is published under a hash that the settlement transaction carries.
- The certificate is bound to one order id, spec, rubric, model, and output. It is worthless anywhere else.

## Repository layout

```
contracts/          Foundry. MetrxCore.sol + SettlementMath.sol, 50 tests including fuzz
packages/reference/ Independent TypeScript model of the same settlement rules, 53 tests
packages/shared/    Chain config, ABI, canonical hashing, EIP-712 types
workers/api/        Cloudflare Worker: AI verifier (Groq), artifact store, proof bundles
apps/web/           Vite + React app: landing, buyer, operator, verifier, proof
scripts/            Seam check, key generation, mainnet proof runs, claim ledger check
```

## Quick start

```bash
git clone --recurse-submodules https://github.com/winsznx/metrx && cd metrx
pnpm install
pnpm keys:generate      # writes DEPLOYER / AI_VERIFIER / DEMO_OPERATOR keys to .env
pnpm seam:check         # live BOT Chain assumptions -> SEAM_REPORT.md
pnpm contracts:test     # 50 Foundry tests
pnpm test               # reference model + worker end-to-end tests
```

`pnpm test` runs the worker suite against a local anvil node: it deploys the compiled
mainnet artifact, drives a real order from funding to settlement through the actual API
routes, and asserts that every published artifact still reproduces its on-chain hash. It
also proves that the digest the TypeScript signer produces is the digest Solidity recovers,
which is the one failure mode a unit test on either side alone cannot catch.

### Running locally

```bash
# terminal 1 — the verifier service
cd workers/api && pnpm dev

# terminal 2 — the app
cd apps/web && pnpm dev
```

The verifier runs `AI_PROVIDER=groq` with `openai/gpt-oss-120b` by default. That model
supports strict `json_schema` structured outputs, so the verdict schema is enforced by the
model rather than repaired afterwards — the malformed-response failure mode is removed at
the source instead of being handled. Groq returns `429` with `retry-after` when the key's
quota is spent; the verifier waits out a short reset, and otherwise refuses to sign and says
so, because a settlement certificate is not something to retry blindly.

Set `AI_PROVIDER=mock` for an offline deterministic verifier. `anthropic`, `openai`, and
`workers-ai` are also supported. Mock verdicts are tagged as mocked in every API response
and labelled in the UI.

## Deploying

The deployer is generated locally and starts empty. Fund it with native BOT first:

```bash
pnpm seam:check         # prints the address and the current lifecycle cost estimate
```

Then:

```bash
pnpm contracts:deploy   # broadcasts MetrxCore with --legacy (the chain has a zero base fee)
pnpm abi:sync           # copies the ABI and patches the address into packages/shared
pnpm contracts:verify   # verifies source on BOTScan
```

Then wire the address into the two deployed surfaces:

```bash
# verifier service — address is a var, keys are secrets
cd workers/api
sed -i '' 's|METRX_CORE_ADDRESS = ""|METRX_CORE_ADDRESS = "0xYourCore"|' wrangler.toml
npx wrangler secret put AI_VERIFIER_PRIVATE_KEY     # already set on the live worker
npx wrangler secret put GROQ_API_KEY                # required for real adjudication
npx wrangler deploy

# web app — Vite inlines these at build time
cd ../../apps/web
VITE_METRX_CORE_ADDRESS=0xYourCore \
VITE_API_BASE_URL=https://metrx-api.timjosh507.workers.dev \
VITE_AI_VERIFIER_ADDRESS=0x10053A1406C7024Fd237fe4192BC15A0Bc018C8d \
  pnpm build
npx wrangler pages deploy dist --project-name=metrx --branch=main
```

`GET /api/config` reports `signerMatchesContract`. It must be `true` before any proof run,
or every certificate the service signs would be rejected on-chain.

## Producing the mainnet proof

```bash
pnpm proof:run          # runs one PASS lifecycle and one FAIL lifecycle end to end
pnpm claim:verify       # re-reads every ledger claim from chain and fails on any gap
```

`proof:run` writes `PROOF_RUNS.json` with every transaction hash. `claim:verify` reads
those orders back from BOT Chain and refuses to pass if the recorded outcome does not
match on-chain state, or if any recorded run was signed in mock mode.

## Design decisions worth knowing

**Native BOT only.** No USDT, no wrapped token, no ERC-20 approval step. Escrow and stake
are the chain's own asset, which removes an entire class of approval and allowance bugs
from the critical path and one external contract from the trust surface.

**Legacy transactions.** BOT Chain reports a zero base fee, so every write is sent as
type 0 rather than letting a wallet guess at EIP-1559 fields the chain does not use.

**Non-overlapping deadline windows.** A verdict is accepted only up to the verification
deadline; after it, only the timeout refund is possible. Exactly one of the two is valid at
any instant, so there is no race between a late certificate and a timeout claim.

**Conservative verifier timeout.** If no verdict arrives in time, the buyer is refunded and
the operator's stake is released untouched. The operator delivered on time and failed no
obligation it controls. The verifier run and the settlement transaction are both open to
anyone, including the operator, so it can protect itself.

**Pull fallback on payouts.** Payouts are pushed with a bounded gas stipend. A recipient
that reverts is credited instead and can pull with `withdraw()`, so escrow can never be
stranded by a hostile or non-standard receiver.

**Two independent specifications.** The Foundry suite tests the contract. The TypeScript
reference model tests the same rules written from the spec rather than from the Solidity.
A disagreement between them is a bug report, not a matter of opinion.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — system diagram, state machine, verifier sequence
- [SECURITY.md](SECURITY.md) — trust model, guarantees, known limitations
- [WHAT_IS_REAL.md](WHAT_IS_REAL.md) — what ships, what is trusted, what is not claimed
- [CLAIM_LEDGER.md](CLAIM_LEDGER.md) — every public claim with its proof level and evidence
- [SEAM_REPORT.md](SEAM_REPORT.md) — live chain assumptions, regenerated by `pnpm seam:check`

## License

MIT
