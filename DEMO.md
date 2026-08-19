# Demo script

Three minutes, one browser, no terminal. The point of the walkthrough is that a judge
watches money move on BOT Chain Mainnet because an AI said so, and can check every step
afterwards without trusting the video.

Have ready: a wallet with a small BOT balance on chain 677, and a second wallet for the
operator. Open https://metrx.pages.dev.

---

## 0:00 — the claim (20s)

Land on `/`.

> "Compute jobs happen off-chain. Payment disputes happen in DMs. Metrx moves the last step
> on-chain: a buyer funds a job, an operator delivers, and an AI verifier signs a verdict
> that BOT Chain enforces as PAY, REFUND, or SLASH."

Scroll to the trust-boundary section and read one line out loud:

> "This is publicly auditable AI adjudication enforced by settlement. It is not proof that
> the compute happened."

Saying the limitation before anyone asks is the whole positioning.

## 0:20 — fund a job (40s)

`Launch app` → `Create compute order`. Connect the buyer wallet.

Walk the four steps quickly, pausing on two:

- **Rubric.** "These three rules are exactly what the AI verifier will judge against. Nothing
  else." Point out that they are fixed before any operator sees the job.
- **Review.** "These hashes go on-chain. The spec, the input, the rubric, and the verifier
  model are all committed before a single BOT moves."

Fund. Show the transaction confirming and the order page opening on its own.

## 1:00 — deliver (30s)

Switch to the operator wallet. `/app/operator`.

If registering live: "The operator stakes native BOT. That stake is what makes the order
worth funding." Otherwise show the existing stake and note the locked amount.

Accept the job. Point at the stake panel: locked goes up by the order's max slash.

Paste a good output and submit. Show the `outputHash` appearing under the textarea before
submitting: "the output is committed before the verifier ever sees it."

## 1:30 — the verdict (45s)

`Run the AI verifier`.

While it runs: "The verifier reads the spec, the rubric, and that exact committed output. It
returns a structured verdict and signs an EIP-712 certificate. It does not hold funds and it
does not broadcast anything."

When it lands, show three things in order:

1. `PASS` with a score, and the per-rubric findings.
2. The reason text, in full.
3. The signed certificate block: signer address, model, digest, signature. Expand the raw
   typed data for one second.

`Submit verdict on-chain`. Show the transaction confirm and the outcome flip to PAY.

## 2:15 — the failure case (30s)

This is the part that separates escrow from settlement. Either run a second job live with a
deliberately off-topic output, or open [order #3](https://metrx.pages.dev/proof/3) from `/proof`.

Show the verifier's FAIL reasoning naming which rubric items were missed, then the outcome:
buyer refunded the escrow **plus** the operator's slashed stake.

> "Same contract, same verifier, opposite outcome. Nobody negotiated."

## 2:45 — the proof (15s)

Open `/proof` in a fresh window with no wallet connected.

Open the PAY order ([#2](https://metrx.pages.dev/proof/2)). Scroll to **Hash checks** and let it sit on screen:

> "Every published artifact is re-hashed and compared to what the contract stored. If anyone
> swapped the evidence after settlement, this table says MISMATCH."

Close on the BOTScan link for the settlement transaction.

---

## Recording notes

- Record at 1280×800 or wider. The order detail and proof pages use a two-column layout that
  collapses below ~1000px.
- Use a real BOT balance. A "insufficient BOT" state on camera undercuts the whole point.
- Do not cut the transaction confirmations. The waiting is the proof.
- Keep the wrong-network banner out of the recording by switching to chain 677 first.
- If the verifier is still in mock mode, say so on camera. The UI already labels it, and
  getting caught hiding it costs more than admitting it.

## What a judge should be able to do afterwards

1. Open `/proof` with no wallet and read both lifecycles.
2. Click through to BOTScan and see the settlement transactions.
3. Open the repo, run `pnpm contracts:test` and `pnpm test`, and get 52 and 80 passing.
4. Run `pnpm claim:verify` and watch every claim re-read from chain.
