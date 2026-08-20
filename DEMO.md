# Demo script

About four minutes, one browser, no terminal. The point of the walkthrough is that a judge
watches money move on BOT Chain Mainnet because an AI said so, and can check every step
afterwards without trusting the video.

Budget four minutes, not three: two of the beats wait on real mainnet transactions, and the
waiting is the proof — do not rush or cut it.

---

## Before you record (prep)

- **Buyer wallet** with a small BOT balance, already switched to **chain 677** so the
  wrong-network banner never appears on camera.
- **Operator in a second browser profile**, not a second account in the same wallet. Switching
  accounts inside one extension mid-recording is the easiest thing to fumble. The operator is
  **already registered with stake locked**, so the only operator action on camera is accepting.
- Confirm the two pre-settled orders are live: **[#2 PAID](https://metrx.pages.dev/proof/2)** and
  **[#3 SLASHED](https://metrx.pages.dev/proof/3)**. #3 is the failure case — you will not run a
  second job live.
- A third tab on **/proof with no wallet connected**.
- Do one dry run. Mainnet finality varies; know roughly how long a confirm takes today.

---

## 0:00 — the claim (25s)

Land on `/`.

> "Compute jobs happen off-chain. Payment disputes happen in DMs. Metrx moves the last step
> on-chain: a buyer funds a job, an operator delivers, and an AI verifier signs a verdict
> that BOT Chain enforces as PAY, REFUND, or SLASH."

Scroll to the trust-boundary section and read one line out loud:

> "This is publicly auditable AI adjudication enforced by settlement. It is not proof that
> the compute happened."

Saying the limitation before anyone asks is the whole positioning.

## 0:25 — fund a job (60s)

`Launch app` → `Create compute order`. Connect the buyer wallet.

Walk the four steps quickly, pausing on two:

- **Rubric.** "These three rules are exactly what the AI verifier will judge against. Nothing
  else." Point out that they are fixed before any operator sees the job.
- **Review.** "These hashes go on-chain. The spec, the input, the rubric, and the verifier
  model are all committed before a single BOT moves."

Fund. Let the transaction confirm on screen — do not cut it — and show the order page opening
on its own.

## 1:25 — deliver (45s)

Switch to the **operator browser profile** (already staked). `/app/operator`.

Point at the stake panel: "The operator staked native BOT up front. That stake is what makes
the order worth funding." Accept the job and show locked go up by the order's max slash.

Paste a good output and submit. Show the `outputHash` appearing under the textarea before you
submit: "the output is committed before the verifier ever sees it."

## 2:10 — the verdict (55s)

`Run the AI verifier`.

While it runs, say the line that matters most for the AI track:

> "The model isn't answering a question or writing copy. Its signed verdict is the only thing
> that releases escrow — remove the model and nothing settles. That's what makes this AI-native
> and not a chatbot bolted onto an app."

When it lands, show three things in order:

1. `PASS` with a score, and the per-rubric findings.
2. The reason text, in full.
3. The signed certificate block: signer address, model, digest, signature. Expand the raw
   typed data for one second.

`Submit verdict on-chain`. Let the transaction confirm and show the outcome flip to PAY.

## 3:05 — the failure case (35s)

This is the part that separates escrow from settlement. Open the pre-settled
**[order #3](https://metrx.pages.dev/proof/3)** from `/proof` — produced exactly the same way
you just showed, with a deliberately off-topic output.

Show the verifier's FAIL reasoning naming which rubric items were missed, then the outcome:
buyer refunded the escrow **plus** the operator's slashed stake.

> "Same contract, same verifier, opposite outcome. Nobody negotiated."

## 3:40 — the proof and the chain (20s)

Open the PAY order (**[#2](https://metrx.pages.dev/proof/2)**) in the no-wallet `/proof` tab.
Scroll to **Hash checks** and let it sit on screen:

> "Every published artifact is re-hashed and compared to what the contract stored. If anyone
> swapped the evidence after settlement, this table says MISMATCH."

Close on the BOTScan link for the settlement transaction:

> "The contract is source-verified on BOTScan and settles in native BOT — no token approvals,
> no bridge. This is a real deployment on BOT Chain Mainnet, not a testnet."

<!-- Optional, only if you want to bank more of the integration score and it stays accurate to
     ARCHITECTURE.md: "The client uses legacy transactions for BOT Chain's zero base fee and
     batches reads instead of relying on Multicall3." -->

---

## Recording notes

- Record at 1280×800 or wider. The order detail and proof pages use a two-column layout that
  collapses below ~1000px.
- Use a real BOT balance. An "insufficient BOT" state on camera undercuts the whole point.
- Do not cut the transaction confirmations. The waiting is the proof.
- Keep the wrong-network banner out of the recording by switching to chain 677 first.
- If the verifier is still in mock mode, say so on camera. The UI already labels it, and
  getting caught hiding it costs more than admitting it.
- If a transaction is slow, name it: "that's mainnet finality, not a hang." Composure reads as
  confidence.

## What a judge should be able to do afterwards

1. Open `/proof` with no wallet and read both lifecycles.
2. Click through to BOTScan and see the settlement transactions.
3. Open the repo, run `pnpm contracts:test` and `pnpm test`, and get 52 and 80 passing.
4. Run `pnpm claim:verify` and watch every claim re-read from chain.
5. Paste any proof link (e.g. `/proof/2` or `/proof/3`) into a chat and watch it unfurl with
   that order's settlement card.
