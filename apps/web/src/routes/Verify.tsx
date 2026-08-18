import {useEffect, useState} from "react";
import {Link, useParams} from "react-router-dom";
import {isTerminal, type DeliveryArtifact, type JobSpec} from "@metrx/shared";
import {api, readArtifact, type SignedVerdictResponse, type VerifierConfig} from "@/lib/api";
import {useMetrxWrite, useNetworkGate, useOrder} from "@/lib/contract";
import {botAmount, scoreLabel, timestamp} from "@/lib/format";
import {humanError, type FriendlyError} from "@/lib/errors";
import {
  AddressLink,
  Card,
  EmptyState,
  ErrorNotice,
  Eyebrow,
  Mono,
  Notice,
  Row,
  Section,
  Spinner,
  StatusPill,
  TxLink,
} from "@/components/primitives";
import {ConnectButton, NetworkBanner} from "@/components/Wallet";
import {DeployGate} from "@/components/DeployGate";
import {useAccount} from "wagmi";

export default function Verify() {
  const {id} = useParams();
  const orderId = /^\d+$/.test(id ?? "") ? BigInt(id!) : null;
  const order = useOrder(orderId);
  const {isConnected} = useAccount();
  const {wrongNetwork} = useNetworkGate();
  const tx = useMetrxWrite();

  const [config, setConfig] = useState<VerifierConfig | null>(null);
  const [spec, setSpec] = useState<JobSpec | null>(null);
  const [delivery, setDelivery] = useState<DeliveryArtifact | null>(null);
  const [running, setRunning] = useState(false);
  const [verdict, setVerdict] = useState<SignedVerdictResponse | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);

  useEffect(() => {
    api.config().then(setConfig).catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    if (!order.data) return;
    readArtifact<JobSpec>(order.data.jobSpecHash).then(setSpec);
    readArtifact<DeliveryArtifact>(order.data.deliveryArtifactHash).then(setDelivery);
  }, [order.data]);

  const run = async () => {
    if (!orderId) return;
    setError(null);
    setRunning(true);
    try {
      setVerdict(await api.runVerifier(orderId));
    } catch (e) {
      setError(humanError(e));
    } finally {
      setRunning(false);
    }
  };

  const settle = async () => {
    if (!verdict) return;
    const a = verdict.submit.args;
    const hash = await tx.send("settleWithAIVerdict", [BigInt(a[0]), a[1], a[2], a[3], a[4], a[5]]);
    if (hash) order.reload();
  };

  if (!orderId) {
    return (
      <Section className="py-14">
        <EmptyState title="That is not a valid order id" />
      </Section>
    );
  }

  const settled = !!order.data && isTerminal(order.data.status);

  return (
    <Section className="py-14" width="narrow">
      <Link to={`/app/orders/${orderId}`} className="text-sm text-slate underline underline-offset-2 hover:text-ink">
        ← Order #{orderId.toString()}
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>AI verifier</Eyebrow>
          <h1 className="headline mt-2 text-[38px]">Judge and settle order #{orderId.toString()}</h1>
        </div>
        {order.data && <StatusPill status={order.data.status} />}
      </div>

      <p className="mt-4 text-[17px] leading-relaxed text-slate">
        The verifier reads the job spec, the buyer's rubric, and the operator's committed output, then signs an EIP-712
        certificate. Anyone can submit that certificate. The contract recovers the signature and enforces the result.
      </p>

      <div className="mt-8 space-y-4">
        <DeployGate>
          <NetworkBanner />
          {config?.verifier.mocked && (
            <Notice tone="warn" title="Mock verifier">
              This service is configured with AI_PROVIDER=mock, so the verdict below comes from a deterministic local
              stand-in rather than a model. It is a rehearsal, not a real adjudication.
            </Notice>
          )}
          {config && !config.verifier.mocked && config.verifier.schemaEnforced && (
            <Notice tone="good" title="Schema-enforced verdict">
              <span className="mono">{config.verifier.modelId}</span> returns the verdict under a strict JSON schema, so
              the shape of the adjudication is enforced by the model itself. The verifier still refuses to sign a
              verdict that contradicts its own rubric findings.
            </Notice>
          )}
          {config && !config.verifier.signerMatchesContract && config.verifier.signerAddress && (
            <Notice tone="bad" title="Verifier key does not match the contract">
              This service signs as <span className="mono">{config.verifier.signerAddress}</span> but the contract only
              accepts <span className="mono">{config.verifier.onChainVerifier ?? "an unknown address"}</span>. A
              certificate signed here would be rejected on-chain.
            </Notice>
          )}
        </DeployGate>
      </div>

      {order.loading && (
        <div className="mt-10">
          <Spinner label="Reading this order from BOT Chain…" />
        </div>
      )}

      {order.data && order.data.status !== "Delivered" && !settled && (
        <div className="mt-8">
          <Notice tone="neutral" title={`Order is ${order.data.status}, not delivered`}>
            The verifier only judges a delivered output. There is nothing to evaluate yet.
          </Notice>
        </div>
      )}

      {settled && order.data && (
        <div className="mt-8">
          <Notice tone={order.data.status === "Paid" ? "good" : "neutral"} title="This order is already settled">
            <Link className="underline underline-offset-2" to={`/proof/${orderId}`}>
              Read the public proof
            </Link>
          </Notice>
        </div>
      )}

      {order.data?.status === "Delivered" && (
        <>
          <Card className="mt-8 p-7">
            <Eyebrow>What the verifier will read</Eyebrow>
            {spec ? (
              <>
                <h2 className="headline mt-2 text-[22px]">{spec.title}</h2>
                <div className="mt-4">
                  <Eyebrow>Rubric</Eyebrow>
                  <ol className="mt-2 space-y-2">
                    {spec.rubric.map((r, i) => (
                      <li key={i} className="flex gap-3 text-[15px] text-slate">
                        <span className="mono shrink-0 text-stone">{i}</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate">The job spec artifact is not published, so the verifier will refuse to judge.</p>
            )}

            {delivery && (
              <div className="mt-6">
                <Eyebrow>Delivered output</Eyebrow>
                <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl bg-mist/45 p-4 text-[14px] leading-relaxed text-ink">
                  {delivery.output}
                </p>
              </div>
            )}

            <div className="mt-6">
              <Row label="outputHash on chain">
                <Mono value={order.data.outputHash} />
              </Row>
              <Row label="rubricHash on chain">
                <Mono value={order.data.rubricHash} />
              </Row>
              <Row label="Model committed by the buyer">
                <Mono value={order.data.modelHash} />
              </Row>
              {config && (
                <Row label="Model this service runs">
                  <span className="mono">{config.verifier.modelId}</span>
                </Row>
              )}
            </div>
          </Card>

          <div className="mt-6 space-y-4">
            <ErrorNotice error={error} />
            {!verdict && (
              <button type="button" className="btn btn-primary" disabled={running} onClick={run}>
                {running ? "Evaluating output against rubric…" : "Run AI verifier"}
              </button>
            )}
            {running && <Spinner label="Evaluating output against rubric…" />}
          </div>

          {verdict && (
            <>
              <Card className="mt-8 p-7">
                <Eyebrow>Verdict</Eyebrow>
                <div className="mt-2 flex flex-wrap items-baseline gap-4">
                  <span className={`headline text-[40px] ${verdict.verdict === "PASS" ? "text-deep" : "text-clay"}`}>
                    {verdict.verdict}
                  </span>
                  <span className="text-[17px] text-slate">score {scoreLabel(verdict.scoreBps)}</span>
                </div>
                <p className="mt-4 text-[15px] leading-relaxed text-slate">{verdict.reason}</p>

                {verdict.rubricFindings.length > 0 && (
                  <ul className="mt-5 space-y-2">
                    {verdict.rubricFindings.map((f) => (
                      <li key={f.rubricIndex} className="flex gap-3 text-sm">
                        <span className={f.satisfied ? "text-deep" : "text-clay"}>
                          {f.satisfied ? "met" : "not met"}
                        </span>
                        <span className="text-slate">
                          Rule {f.rubricIndex} — {f.note}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-6">
                  <Eyebrow>Signed certificate</Eyebrow>
                  <div className="mt-2">
                    <Row label="Signed by">
                      <AddressLink address={verdict.verifierAddress} />
                    </Row>
                    <Row label="Model">
                      <span className="mono">{verdict.modelId}</span>
                    </Row>
                    <Row label="Provider">
                      {verdict.provider}
                      {verdict.mocked ? " (mock)" : ""}
                    </Row>
                    {verdict.rateLimit?.requestsRemaining && (
                      <Row label="Provider quota left">
                        {verdict.rateLimit.requestsRemaining} requests
                        {verdict.rateLimit.tokensRemaining ? `, ${verdict.rateLimit.tokensRemaining} tokens` : ""}
                      </Row>
                    )}
                    <Row label="Evaluated at">{timestamp(verdict.evaluatedAt)}</Row>
                    <Row label="reasonHash">
                      <Mono value={verdict.reasonHash} />
                    </Row>
                    <Row label="EIP-712 digest">
                      <Mono value={verdict.digest} />
                    </Row>
                    <Row label="Signature">
                      <Mono value={verdict.signature} lead={12} tail={8} />
                    </Row>
                  </div>
                </div>

                <details className="mt-5">
                  <summary className="cursor-pointer text-sm text-slate hover:text-ink">
                    Show the raw typed data the verifier signed
                  </summary>
                  <pre className="mono mt-3 overflow-x-auto rounded-xl bg-mist/45 p-4 text-[12px] leading-relaxed">
                    {JSON.stringify(verdict.typedData, null, 2)}
                  </pre>
                </details>
              </Card>

              <Card className="mt-4 p-7">
                <Eyebrow>Settle on-chain</Eyebrow>
                <p className="mt-2 text-[15px] leading-relaxed text-slate">
                  {verdict.verdict === "PASS"
                    ? `Submitting this certificate releases ${botAmount(order.data.price)} to the operator and unlocks its stake.`
                    : `Submitting this certificate refunds ${botAmount(order.data.price)} to the buyer and transfers the operator's ${botAmount(order.data.maxSlash)} slashed stake on top.`}
                </p>

                <div className="mt-5 space-y-3">
                  {!isConnected ? (
                    <ConnectButton />
                  ) : (
                    <>
                      {tx.phase === "awaiting-signature" && <Spinner label="Confirm in your wallet…" />}
                      {tx.phase === "pending" && tx.hash && (
                        <p className="text-sm text-slate">
                          Waiting for confirmation · <TxLink hash={tx.hash} />
                        </p>
                      )}
                      {tx.phase === "confirmed" && tx.hash && (
                        <Notice tone="good" title={`Settled as ${verdict.verdict === "PASS" ? "PAY" : "SLASH"}`}>
                          <TxLink hash={tx.hash} label="View the settlement transaction" /> ·{" "}
                          <Link className="underline underline-offset-2" to={`/proof/${orderId}`}>
                            Open the proof page
                          </Link>
                        </Notice>
                      )}
                      <ErrorNotice error={tx.error} />
                      {tx.phase !== "confirmed" && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={tx.busy || wrongNetwork}
                          onClick={settle}
                        >
                          {tx.busy ? "Working…" : "Submit verdict on-chain"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </Section>
  );
}
