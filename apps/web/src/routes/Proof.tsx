import {useEffect, useState} from "react";
import {Link, useParams} from "react-router-dom";
import {ORDER_STATUS, ZERO_ADDRESS, explorerAddress, explorerContract, type OrderStatus} from "@metrx/shared";
import {api, type ProofIndexResponse, type ProofResponse} from "@/lib/api";
import {API_BASE, CORE_ADDRESS, DEMO_VIDEO_URL, GITHUB_URL} from "@/lib/config";
import {botAmount, scoreLabel, timestamp} from "@/lib/format";
import {humanError, type FriendlyError} from "@/lib/errors";
import {
  Card,
  EmptyState,
  ErrorNotice,
  Eyebrow,
  Mono,
  Notice,
  Row,
  Section,
  Spinner,
  Stat,
  StatusPill,
} from "@/components/primitives";

// ---------------------------------------------------------------------------
// /proof — judge hub
// ---------------------------------------------------------------------------

/** The proof API serialises every numeric chain field as a decimal string. */
const statusOf = (order: Record<string, string>): OrderStatus => ORDER_STATUS[Number(order.status)] ?? "None";

export function ProofHub() {
  const [index, setIndex] = useState<ProofIndexResponse | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .proofIndex(50)
      .then(setIndex)
      .catch((e) => setError(humanError(e)))
      .finally(() => setLoading(false));
  }, []);

  const orders = index?.orders ?? [];
  const paid = orders.filter((o) => statusOf(o) === "Paid");
  const slashed = orders.filter((o) => statusOf(o) === "Slashed");

  return (
    <Section className="py-14">
      <Eyebrow>Proof hub</Eyebrow>
      <h1 className="headline mt-2 text-[38px]">Read the settlements. No wallet needed.</h1>
      <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-slate">
        Every order below is a real BOT Chain Mainnet transaction. Open one to see the job spec, the delivered output,
        the AI verifier's signed verdict, and the transaction that enforced it.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-4">
        <Card>
          <Stat label="Orders" value={orders.length} />
        </Card>
        <Card>
          <Stat label="Settled PAY" value={paid.length} />
        </Card>
        <Card>
          <Stat label="Settled SLASH" value={slashed.length} />
        </Card>
        <Card>
          <Stat
            label="Refunded"
            value={orders.filter((o) => ["Refunded", "Cancelled"].includes(statusOf(o))).length}
          />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Card className="p-6">
          <Eyebrow>MetrxCore</Eyebrow>
          {CORE_ADDRESS ? (
            <a
              className="mono mt-2 block break-all text-ink underline decoration-ink/25 underline-offset-2"
              href={explorerContract(CORE_ADDRESS)}
              target="_blank"
              rel="noreferrer"
            >
              {CORE_ADDRESS}
            </a>
          ) : (
            <p className="mt-2 text-sm text-stone">Not broadcast yet.</p>
          )}
        </Card>
        <Card className="p-6">
          <Eyebrow>AI verifier</Eyebrow>
          {index?.aiVerifier ? (
            <a
              className="mono mt-2 block break-all text-ink underline decoration-ink/25 underline-offset-2"
              href={explorerAddress(index.aiVerifier)}
              target="_blank"
              rel="noreferrer"
            >
              {index.aiVerifier}
            </a>
          ) : (
            <p className="mt-2 text-sm text-stone">Reported once the contract is live.</p>
          )}
        </Card>
        <Card className="p-6">
          <Eyebrow>Source and demo</Eyebrow>
          {GITHUB_URL ? (
            <a
              className="mt-2 block text-sm text-ink underline decoration-ink/25 underline-offset-2"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
            >
              GitHub repository
            </a>
          ) : (
            <p className="mt-2 text-sm text-stone">Source link published with the submission.</p>
          )}
          {DEMO_VIDEO_URL ? (
            <a
              className="mt-1 block text-sm text-ink underline decoration-ink/25 underline-offset-2"
              href={DEMO_VIDEO_URL}
              target="_blank"
              rel="noreferrer"
            >
              Demo video
            </a>
          ) : (
            <Link className="mt-1 block text-sm text-ink underline decoration-ink/25 underline-offset-2" to="/app/onboarding">
              Run the lifecycle yourself
            </Link>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <ErrorNotice error={error} />
      </div>

      {(paid[0] || slashed[0]) && (
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {paid[0] && <FeaturedProof order={paid[0]} kind="PAY" />}
          {slashed[0] && <FeaturedProof order={slashed[0]} kind="SLASH" />}
        </div>
      )}

      <div className="mt-10">
        <Eyebrow>All orders</Eyebrow>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {loading ? (
            <Spinner label="Reading BOT Chain…" />
          ) : error ? (
            <div className="md:col-span-2">
              <Notice tone="bad" title="Proof API unreachable">
                <p>
                  {error.detail} The contract itself is unaffected — read it directly on{" "}
                  <a
                    className="text-ink underline underline-offset-2"
                    href={CORE_ADDRESS ? explorerAddress(CORE_ADDRESS) : "https://scan.botchain.ai"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    BOTScan
                  </a>
                  , or try <Link className="text-ink underline underline-offset-2" to="/proof/1">order #1</Link> and{" "}
                  <Link className="text-ink underline underline-offset-2" to="/proof/2">order #2</Link> directly.
                </p>
              </Notice>
            </div>
          ) : orders.length === 0 ? (
            <div className="md:col-span-2">
              <EmptyState title="No orders on this contract yet">
                This page shows only what actually settled on mainnet. It stays empty until the first order does.
              </EmptyState>
            </div>
          ) : (
            orders.map((o) => <ProofListCard key={o.id} order={o} />)
          )}
        </div>
      </div>

      <div className="mt-10">
        <Card className="p-6">
          <Eyebrow>Claim ledger</Eyebrow>
          <p className="mt-2 text-sm text-slate">
            Every claim Metrx makes is graded by proof level and re-checked against BOT Chain by a command in the
            repository. Nothing on this site is asserted above the evidence behind it.
          </p>
          <p className="mono mt-3 text-[13px] text-ink">pnpm claim:verify</p>
          <p className="mt-3 text-sm text-slate">
            Read the full ledger in{" "}
            {GITHUB_URL ? (
              <a
                className="text-ink underline underline-offset-2"
                href={`${GITHUB_URL}/blob/main/CLAIM_LEDGER.md`}
                target="_blank"
                rel="noreferrer"
              >
                CLAIM_LEDGER.md
              </a>
            ) : (
              <span className="mono">CLAIM_LEDGER.md</span>
            )}
            , or the honest-status summary in{" "}
            <Link className="text-ink underline underline-offset-2" to="/docs/what-is-real">
              what is real
            </Link>
            .
          </p>
        </Card>
      </div>

      <div className="mt-4">
        <Notice tone="neutral" title="What this page does not prove">
          Metrx enforces an AI verifier's signed verdict. It does not prove the compute itself was performed correctly,
          privately, or on any particular hardware.{" "}
          <Link className="underline underline-offset-2" to="/docs/what-is-real">
            Read the full limitations
          </Link>
          .
        </Notice>
      </div>
    </Section>
  );
}

/** The PAY and SLASH proofs a judge is looking for, promoted above the list. */
function FeaturedProof({order, kind}: {order: Record<string, string>; kind: "PAY" | "SLASH"}) {
  return (
    <Link to={`/proof/${order.id}`} className="card p-7 transition-colors hover:border-ink/25">
      <Eyebrow>{kind === "PAY" ? "Completed PAY lifecycle" : "Completed SLASH lifecycle"}</Eyebrow>
      <p className={`headline mt-2 text-[34px] ${kind === "PAY" ? "text-deep" : "text-clay"}`}>{kind}</p>
      <p className="mt-2 text-sm text-slate">
        {kind === "PAY"
          ? `The AI verifier passed the delivered output at ${scoreLabel(Number(order.scoreBps ?? 0))} and the contract released ${botAmount(BigInt(order.price ?? "0"))} to the operator.`
          : `The AI verifier failed the delivered output. The buyer was refunded and the operator's stake was slashed.`}
      </p>
      <p className="mt-4 text-sm text-ink underline decoration-ink/25 underline-offset-2">
        Open order #{order.id} →
      </p>
    </Link>
  );
}

function ProofListCard({order}: {order: Record<string, string>}) {
  const status = statusOf(order);
  return (
    <Link to={`/proof/${order.id}`} className="card p-6 transition-colors hover:border-ink/25">
      <div className="flex items-center justify-between">
        <span className="mono text-stone">Order #{order.id}</span>
        <StatusPill status={status} />
      </div>
      <p className="headline mt-3 text-[24px]">{botAmount(BigInt(order.price ?? "0"))}</p>
      <p className="mt-2 text-sm text-slate">
        {status === "Paid"
          ? `Passed at ${scoreLabel(Number(order.scoreBps ?? 0))} and paid the operator.`
          : status === "Slashed"
            ? "Failed. Buyer refunded and operator slashed."
            : status === "Refunded"
              ? "Refunded to the buyer."
              : status === "Cancelled"
                ? "Cancelled before any operator committed."
                : "In flight."}
      </p>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// /proof/:id — single public proof
// ---------------------------------------------------------------------------

export function ProofDetail() {
  const {id} = useParams();
  const [proof, setProof] = useState<ProofResponse | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .proof(id)
      .then(setProof)
      .catch((e) => setError(humanError(e)))
      .finally(() => setLoading(false));
  }, [id]);

  const status = proof ? statusOf(proof.order) : null;

  return (
    <Section className="py-14" width="narrow">
      <Link to="/proof" className="text-sm text-slate underline underline-offset-2 hover:text-ink">
        ← Proof hub
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Public proof</Eyebrow>
          <h1 className="headline mt-2 text-[38px]">Order #{id}</h1>
        </div>
        {status && <StatusPill status={status} />}
      </div>

      {loading && (
        <div className="mt-10">
          <Spinner label="Assembling the proof bundle…" />
        </div>
      )}
      <div className="mt-6">
        <ErrorNotice error={error} />
      </div>

      {proof && (
        <>
          <Card className="mt-8 p-7">
            <Eyebrow>Outcome</Eyebrow>
            <p className="headline mt-2 text-[40px]">{proof.outcome}</p>
            <p className="mt-3 text-[15px] leading-relaxed text-slate">{outcomeSentence(proof, status)}</p>
            <div className="mt-5">
              <Row label="Escrow">{botAmount(BigInt(proof.order.price))}</Row>
              <Row label="Stake at risk">{botAmount(BigInt(proof.order.maxSlash))}</Row>
              <Row label="Buyer">
                <a className="mono underline underline-offset-2" href={proof.explorer.buyer} target="_blank" rel="noreferrer">
                  {proof.order.buyer}
                </a>
              </Row>
              {proof.order.operator !== ZERO_ADDRESS && (
                <Row label="Operator">
                  <a
                    className="mono underline underline-offset-2"
                    href={proof.explorer.operator}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {proof.order.operator}
                  </a>
                </Row>
              )}
              <Row label="Settlement contract">
                <a
                  className="mono underline underline-offset-2"
                  href={`${proof.explorer.contract}#code`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {proof.contract}
                </a>
              </Row>
              <Row label="AI verifier">
                <a
                  className="mono underline underline-offset-2"
                  href={proof.explorer.verifier}
                  target="_blank"
                  rel="noreferrer"
                >
                  {proof.aiVerifier}
                </a>
              </Row>
              <Row label="Created">{timestamp(Number(proof.order.createdAt))}</Row>
              {Number(proof.order.acceptedAt) > 0 && (
                <Row label="Accepted">{timestamp(Number(proof.order.acceptedAt))}</Row>
              )}
              {Number(proof.order.deliveredAt) > 0 && (
                <Row label="Delivered">{timestamp(Number(proof.order.deliveredAt))}</Row>
              )}
              {Number(proof.order.evaluatedAt) > 0 && (
                <Row label="Verdict signed">{timestamp(Number(proof.order.evaluatedAt))}</Row>
              )}
              <Row label="Settled at">{timestamp(Number(proof.order.settledAt))}</Row>
              {proof.settlementTx && (
                <Row label="Settlement transaction">
                  <a
                    className="mono underline underline-offset-2"
                    href={`https://scan.botchain.ai/tx/${proof.settlementTx}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {proof.settlementTx.slice(0, 18)}…{proof.settlementTx.slice(-8)}
                  </a>
                </Row>
              )}
            </div>
          </Card>

          {proof.timeline.length > 0 && (
            <Card className="mt-4 p-7">
              <Eyebrow>Transaction trail</Eyebrow>
              <p className="mt-2 text-sm text-slate">
                Every step of this order as it happened on BOT Chain. Open any of them on the explorer.
              </p>
              <ol className="mt-4 space-y-1">
                {proof.timeline.map((t, i) => (
                  <li
                    key={`${t.txHash}-${t.event}-${i}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/8 py-2.5 last:border-0"
                  >
                    <span className="text-sm text-ink">{t.label}</span>
                    <span className="flex items-center gap-3 text-sm text-stone">
                      {t.timestamp ? timestamp(t.timestamp) : `block ${t.blockNumber}`}
                      <a
                        className="mono text-ink underline decoration-ink/25 underline-offset-2 hover:decoration-ink"
                        href={t.explorer}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t.txHash.slice(0, 10)}…{t.txHash.slice(-6)}
                      </a>
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {proof.reason && (
            <Card className="mt-4 p-7">
              <Eyebrow>AI verdict</Eyebrow>
              <div className="mt-2 flex flex-wrap items-baseline gap-4">
                <span className={`headline text-[32px] ${proof.reason.verdict === "PASS" ? "text-deep" : "text-clay"}`}>
                  {proof.reason.verdict}
                </span>
                <span className="text-slate">score {scoreLabel(proof.reason.scoreBps)}</span>
                <span className="mono text-stone">{proof.reason.modelId}</span>
                {proof.reason.provider && (
                  <span className={`pill ${proof.reason.mocked ? "bg-amber/20 text-[#7a5518]" : "bg-bot/18 text-deep"}`}>
                    {proof.reason.mocked ? "mock verifier" : `signed by ${proof.reason.provider}`}
                  </span>
                )}
              </div>
              <p className="mt-4 text-[15px] leading-relaxed text-slate">{proof.reason.reason}</p>
              {proof.reason.rubricFindings.length > 0 && (
                <ul className="mt-5 space-y-2">
                  {proof.reason.rubricFindings.map((f) => (
                    <li key={f.rubricIndex} className="flex gap-3 text-sm">
                      <span className={f.satisfied ? "text-deep" : "text-clay"}>{f.satisfied ? "met" : "not met"}</span>
                      <span className="text-slate">
                        Rule {f.rubricIndex} — {f.note}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {proof.jobSpec && (
            <Card className="mt-4 p-7">
              <Eyebrow>What was ordered</Eyebrow>
              <h2 className="headline mt-2 text-[22px]">{proof.jobSpec.title}</h2>
              <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-slate">
                {proof.jobSpec.instructions}
              </p>
              <div className="mt-5">
                <Eyebrow>Input</Eyebrow>
                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-mist/45 p-4 text-[14px] leading-relaxed">
                  {proof.jobSpec.input}
                </p>
              </div>
              <div className="mt-5">
                <Eyebrow>Rubric</Eyebrow>
                <ol className="mt-2 space-y-2">
                  {proof.jobSpec.rubric.map((r, i) => (
                    <li key={i} className="flex gap-3 text-[15px] text-slate">
                      <span className="mono shrink-0 text-stone">{i}</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </Card>
          )}

          {proof.delivery && (
            <Card className="mt-4 p-7">
              <Eyebrow>What was delivered</Eyebrow>
              <p className="mt-2 whitespace-pre-wrap rounded-xl bg-mist/45 p-4 text-[14px] leading-relaxed">
                {proof.delivery.output}
              </p>
            </Card>
          )}

          {proof.certificate && (
            <Card className="mt-4 p-7">
              <Eyebrow>The signed certificate</Eyebrow>
              <p className="mt-2 text-sm text-slate">
                This is the exact EIP-712 payload the AI verifier signed and the contract recovered. Nothing else can
                move this order's escrow.
              </p>
              <div className="mt-4">
                <Row label="Signed by">
                  <a className="mono underline underline-offset-2" href={proof.explorer.verifier} target="_blank" rel="noreferrer">
                    {proof.certificate.verifierAddress}
                  </a>
                </Row>
                <Row label="EIP-712 digest">
                  <Mono value={proof.certificate.digest} />
                </Row>
                <Row label="Signature">
                  <Mono value={proof.certificate.signature} lead={12} tail={8} />
                </Row>
                <Row label="Evaluated at">{timestamp(proof.certificate.evaluatedAt)}</Row>
              </div>
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-slate hover:text-ink">Show the raw typed data</summary>
                <pre className="mono mt-3 overflow-x-auto rounded-xl bg-mist/45 p-4 text-[12px] leading-relaxed">
                  {JSON.stringify(proof.certificate.typedData, null, 2)}
                </pre>
              </details>
            </Card>
          )}

          <Card className="mt-4 p-7">
            <Eyebrow>Hash checks</Eyebrow>
            <p className="mt-2 text-sm text-slate">
              The verifier API recomputes each hash from the published artifact and compares it against what the
              contract stored. A mismatch would mean the evidence was swapped after settlement. Open any artifact below
              and re-derive the hash yourself — keccak256 of the raw bytes for text, of the canonical JSON for objects.
            </p>
            <div className="mt-4 space-y-2">
              {proof.hashChecks.map((c) => (
                <div key={c.label} className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/8 py-2 last:border-0">
                  <span className="text-sm text-ink">{c.label}</span>
                  <span className="flex items-center gap-3">
                    <Mono value={c.onChain} href={`${API_BASE}${c.artifactUrl}`} copy={false} />
                    <span className={`pill ${c.matches ? "bg-bot/18 text-deep" : "bg-clay/14 text-clay"}`}>
                      {c.matches ? "matches" : c.recomputed === null ? "artifact missing" : "MISMATCH"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <div className="mt-6">
            <Notice tone="neutral" title="Honest scope">
              This proves the settlement was enforced by BOT Chain against a verdict signed by the AI verifier the
              contract trusts. It does not prove the operator's compute was performed correctly or privately.
            </Notice>
          </div>
        </>
      )}
    </Section>
  );
}

function outcomeSentence(proof: ProofResponse, status: OrderStatus | null): string {
  const price = botAmount(BigInt(proof.order.price));
  const slash = botAmount(BigInt(proof.order.maxSlash));
  switch (status) {
    case "Paid":
      return `The AI verifier passed the delivered output against the buyer's rubric, and the contract released ${price} to the operator. The operator's stake was unlocked untouched.`;
    case "Slashed":
      return proof.reason?.verdict === "FAIL"
        ? `The AI verifier failed the delivered output. The contract returned ${price} to the buyer and transferred the operator's ${slash} slashed stake on top.`
        : `Nothing was delivered before the deadline. The contract returned ${price} to the buyer and transferred the operator's ${slash} slashed stake on top.`;
    case "Refunded":
      return `The buyer was refunded ${price}. No verdict arrived in time, so the operator's stake was released without penalty.`;
    case "Cancelled":
      return `The buyer cancelled before any operator committed, and the contract returned ${price}.`;
    default:
      return "This order is still in flight and has not reached a terminal state.";
  }
}
