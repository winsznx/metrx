# Demo script

~3–4 minutes, two browser profiles, no terminal. A judge watches money move on BOT Chain
because an AI said so, then verifies it with no wallet. **SAY** lines are deliberately short —
read them, don't pad. **DO** lines are exact clicks.

---

## Before you record

- **Two browser profiles.** Profile A = **buyer** wallet (~0.07 BOT). Profile B = **operator**
  wallet (~0.03 BOT), already registered + staked. Split from your 0.1 BOT wallet, or reuse your
  earlier operator `0x0f4c…624e` (already staked → skip funding).
- Pre-stake the operator: Profile B → `/app/operator` → **Register with … BOT** (`0.01` is plenty).
- Both profiles on **chain 677** so the wrong-network banner never shows.
- Confirm `/proof/2` (PAID) and `/proof/3` (SLASHED) load.
- A third tab on `/proof`, **no wallet connected**.
- One dry run — know how long a mainnet confirm takes today. Never cut a confirmation on camera.

---

## 0:00 — the claim (20s)

**DO:** Land on `/`. Scroll once to the trust-boundary section.
**SAY:** "Compute happens off-chain; payment disputes happen in DMs. Metrx settles the last step
on-chain — fund, deliver, an AI verifier signs a verdict, BOT Chain enforces PAY, REFUND, or SLASH."
**SAY (the honest line):** "It's auditable AI adjudication enforced by settlement — not proof the
compute ran."

## 0:20 — fund a job · Profile A / buyer (55s)

**DO:** Click **Launch app** → you're on `/app`. Go to **Create compute order** (`/app/create`).
The form is pre-filled with an example. Edit the **Title** to your own (this clears the example
banner); leave the 3 rubric rules.
**DO:** Click **Continue** to **Rubric**.
**SAY:** "These three rules are exactly what the AI judges — fixed before any operator sees it."
**DO:** **Continue** to **Terms**. Set **Price** `0.01` and **Max slash in BOT** `0.005`, pick
**Delivery deadline** = 30 minutes. **Continue** to **Review**.
**SAY:** "Spec, input, rubric, and verifier model all hash-commit on-chain before a single BOT moves."
**DO:** Connect the buyer wallet, click **Fund**. Let the tx confirm. It lands on the order page
(`/app/orders/…`).

## 1:15 — deliver · Profile B / operator (40s)

**DO:** Switch to Profile B. Go to `/app/operator`. Under **Open funded jobs**, find the order →
click **Accept job**. Confirm the tx.
**SAY:** "Second wallet, the operator — it staked BOT to take work. It's me here; watch why that
doesn't matter."
**DO:** Under **Your active work**, paste a good result into **Your output**. Point at the
`outputHash` that appears.
**SAY:** "The output commits on-chain before the verifier ever sees it."
**DO:** Click **Submit delivery**. Confirm the tx.

## 1:55 — the verdict · Profile A / buyer (55s)

**DO:** Back in Profile A on the order page, click the primary button **Run the AI verifier**
(opens `/app/verify/…`). Click **Run the AI verifier**.
**SAY (while it runs — the AI-native line):** "The model isn't answering a question. Its signed
verdict is the only thing that releases escrow — remove it and nothing settles."
**DO:** When it lands, show in order: the **Verdict** `PASS` + score, the reason text, then the
**Signed certificate** block — **Signed by**, **Model**, **Signature** — and expand the raw
**typed data** for one second.
**DO:** Under **Settle on-chain**, click **Submit verdict on-chain**. Confirm the tx.
**SAY:** "Escrow just moved to the operator — and I couldn't have forced that. Only the signature did."

## 2:50 — the failure case · no wallet (35s)

**DO:** New tab → `/proof/3` (pre-settled SLASHED). Show the **AI verdict FAIL** reason, then the
outcome: buyer refunded the escrow **plus** the operator's slashed stake.
**SAY:** "Same contract, same verifier, opposite outcome. Nobody negotiated."

## 3:25 — the proof and the chain · no wallet (25s)

**DO:** In the wallet-free `/proof` tab, open **#2** (PAID). Scroll to **Hash checks** and hold on it.
**SAY:** "Every artifact is re-hashed against what the contract stored. Swap the evidence and this
says MISMATCH."
**DO:** Click the BOTScan link for the settlement transaction.
**SAY:** "Source-verified on BOTScan, settled in native BOT — no approvals, no bridge. Real mainnet."

---

## Recording notes

- 1280×800 or wider. Order/proof pages go two-column above ~1000px.
- Real BOT balance — an "insufficient BOT" state on camera undercuts everything.
- Never cut a transaction confirmation. The waiting is the proof.
- If a tx is slow: "that's mainnet finality, not a hang." Composure reads as confidence.
- If the verifier is in mock mode, the page labels it — say so. Hiding it costs more than admitting it.

## What a judge can do afterwards

1. Open `/proof` with no wallet and read both lifecycles.
2. Click through to BOTScan and see the settlement transactions.
3. Clone the repo, run `pnpm contracts:test` and `pnpm test` → 52 and 80 passing.
4. Run `pnpm claim:verify` and watch every claim re-read from chain.
5. Paste any `/proof/2` or `/proof/3` link into a chat and watch it unfurl with that order's card.
