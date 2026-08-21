# Metrx demo screenplay

~3.5 minutes, two browser profiles, no terminal. A judge watches money move on BOT Chain
Mainnet because an AI said so, then verifies it with no wallet.

**Setup before recording**

- Profile A = **buyer** wallet (~0.07 BOT). Profile B = **operator** wallet (~0.03 BOT), already
  registered + staked (`/app/operator` → `Register with … BOT`). Or reuse operator `0x0f4c…624e`.
- Both wallets on **chain 677** (no wrong-network banner).
- `/proof/2` (PAID) and `/proof/3` (SLASHED) load. A third tab on `/proof`, no wallet.
- One dry run. Never cut a transaction confirmation on camera — the waiting is the proof.

---

### 0:00-0:15 — Problem

[Landing page `/` on screen]

“Compute jobs run off-chain. When the output is wrong, payment becomes an argument in DMs, and whoever holds the money wins.

Metrx moves that last step on-chain.”

---

### 0:15-0:32 — Mechanism

[Scroll past the hero to the mechanism and trust-boundary sections]

“A buyer funds a job, an operator delivers, and an AI verifier signs a verdict that BOT Chain enforces as PAY, REFUND, or SLASH.

To be clear up front: this is auditable AI adjudication enforced by settlement. It is not proof the compute itself ran.”

---

### 0:32-1:15 — Fund the job  ·  Account A (buyer)

[Click `Launch app`, then `Create compute order` → `/app/create`. Edit the `Title` to your own. Click `Continue` to `Rubric`, then `Terms`]

“I’m the buyer. I write the job, and — more importantly — the rubric: the exact rules the AI will judge against, fixed before any operator sees the work.”

[On `Terms`, set `Price` 0.01 and `Max slash in BOT` 0.005, pick a `Delivery deadline`. Click `Continue` to `Review`]

“On review, the spec, input, rubric, and verifier model all hash-commit on-chain before a single BOT moves.”

[Connect the buyer wallet, click `Fund`, let the transaction confirm. It opens the order page]

“Now the escrow is funded and locked in the contract.”

---

### 1:15-1:55 — Deliver  ·  Account B (operator)

[Switch to Profile B → `/app/operator`. Under `Open funded jobs`, find the new order → `Accept job`, confirm the transaction]

“Now the operator — a second wallet that staked BOT to take work. It’s me here, and that’s fine; watch why it doesn’t matter.

Accepting locks my stake against the job.”

[Under `Your active work`, paste a good result into `Your output`. Point at the `outputHash`. Click `Submit delivery`, confirm]

“The output commits on-chain, as a hash, before the verifier ever sees it.”

---

### 1:55-2:40 — Verdict  ·  Account A (buyer)

[Back in Profile A on the order page, click `Run the AI verifier` → `/app/verify/…`. Click `Run the AI verifier` again]

“Anyone can run the verifier. It reads the spec, the rubric, and that exact committed output.

The model isn’t answering a question — its signed verdict is the only thing that can release the escrow. Remove it and nothing settles.”

[When it lands, show `Verdict` PASS + score, the reason, then the `Signed certificate` — `Signed by`, `Model`, `Signature`. Expand the raw typed data for a second]

“A signed EIP-712 certificate: the signer, the model, the signature.”

[Under `Settle on-chain`, click `Submit verdict on-chain`, confirm]

“The escrow just moved to the operator. I couldn’t have forced that — only the signature did.”

---

### 2:40-3:05 — Failure case  ·  no wallet

[New tab → `/proof/3` (pre-settled SLASHED)]

“This is what separates escrow from settlement. Same contract, same verifier — but this output failed the rubric.

So the buyer got the escrow back, plus the operator’s slashed stake. Nobody negotiated.”

---

### 3:05-3:25 — Proof  ·  no wallet

[In the wallet-free `/proof` tab, open `#2` (PAID). Scroll to `Hash checks` and hold on it]

“And anyone can check it with no wallet. Every published artifact is re-hashed against what the contract stored. Swap the evidence and this table says MISMATCH.”

[Click the BOTScan link for the settlement transaction]

“Source-verified on BOTScan, settled in native BOT — no approvals, no bridge. Real mainnet.”

---

### 3:25-3:35 — Close

[Return to the PAID order or the landing page. Hold on `metrx.pages.dev`]

“Commit the rules up front. Let an AI decide. Let the chain enforce it.

This is Metrx.”

---

## What a judge can do afterwards

1. Open `/proof` with no wallet and read both lifecycles.
2. Click through to BOTScan and see the settlement transactions.
3. Clone the repo, run `pnpm contracts:test` and `pnpm test` → 52 and 80 passing.
4. Run `pnpm claim:verify` and watch every claim re-read from chain.
5. Paste a `/proof/2` or `/proof/3` link into any chat and watch it unfurl with that order’s card.
