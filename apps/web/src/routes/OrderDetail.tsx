import {useEffect, useState} from "react";
import {Link, useParams} from "react-router-dom";
import {useAccount} from "wagmi";
import {
  ZERO_ADDRESS,
  ZERO_HASH,
  nextAction,
  type DeliveryArtifact,
  type JobSpec,
  type VerifierReason,
} from "@metrx/shared";
import {readArtifact} from "@/lib/api";
import {isRegistered, useMetrxWrite, useNetworkGate, useNow, useOperator, useOrder} from "@/lib/contract";
import {botAmount, relativeDeadline, scoreLabel, timestamp} from "@/lib/format";
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
import {NetworkBanner} from "@/components/Wallet";
import {Timeline} from "@/components/Timeline";
import {DeployGate} from "@/components/DeployGate";

export default function OrderDetail() {
  const {id} = useParams();
  const orderId = /^\d+$/.test(id ?? "") ? BigInt(id!) : null;
  const {address} = useAccount();
  const order = useOrder(orderId);
  const operator = useOperator(address);
  const now = useNow();

  const [spec, setSpec] = useState<JobSpec | null>(null);
  const [delivery, setDelivery] = useState<DeliveryArtifact | null>(null);
  const [reason, setReason] = useState<VerifierReason | null>(null);

  useEffect(() => {
    if (!order.data) return;
    readArtifact<JobSpec>(order.data.jobSpecHash).then(setSpec);
    readArtifact<DeliveryArtifact>(order.data.deliveryArtifactHash).then(setDelivery);
    readArtifact<VerifierReason>(order.data.verdictReasonHash).then(setReason);
  }, [order.data]);

  if (!orderId) {
    return (
      <Section className="py-14">
        <EmptyState title="That is not a valid order id" />
      </Section>
    );
  }

  return (
    <Section className="py-14">
      <Link to="/app/orders" className="text-sm text-slate underline underline-offset-2 hover:text-ink">
        ← All orders
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Order</Eyebrow>
          <h1 className="headline mt-2 text-[38px]">#{orderId.toString()}</h1>
        </div>
        <div className="flex items-center gap-3">
          {order.data && <StatusPill status={order.data.status} />}
          <Link to={`/proof/${orderId}`} className="btn btn-ghost">
            Public proof page
          </Link>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <DeployGate>
          <NetworkBanner />
        </DeployGate>
      </div>

      {order.loading && (
        <div className="mt-10">
          <Spinner label="Reading this order from BOT Chain…" />
        </div>
      )}
      <div className="mt-6">
        <ErrorNotice error={order.error} />
      </div>

      {order.data && (
        <>
          <Card className="mt-8 p-7">
            <Timeline order={order.data} />
          </Card>

          <div className="mt-4">
            <ActionPanel
              order={order.data}
              isOperator={isRegistered(operator.data)}
              now={now}
              onDone={() => {
                order.reload();
                operator.reload();
              }}
            />
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              {spec ? (
                <Card className="p-7">
                  <Eyebrow>Job spec</Eyebrow>
                  <h2 className="headline mt-2 text-[24px]">{spec.title}</h2>
                  <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-slate">{spec.instructions}</p>
                  <div className="mt-6">
                    <Eyebrow>Input</Eyebrow>
                    <p className="mt-2 whitespace-pre-wrap rounded-xl bg-mist/45 p-4 text-[14px] leading-relaxed text-ink">
                      {spec.input}
                    </p>
                  </div>
                  <div className="mt-6">
                    <Eyebrow>Rubric the verifier applies</Eyebrow>
                    <ol className="mt-2 space-y-2">
                      {spec.rubric.map((r, i) => (
                        <li key={i} className="flex gap-3 text-[15px] text-slate">
                          <span className="mono shrink-0 text-stone">{i}</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </Card>
              ) : (
                <Card className="p-7">
                  <Eyebrow>Job spec</Eyebrow>
                  <p className="mt-2 text-sm text-slate">
                    The spec artifact for this order is not in the published store, so only its hash is available.
                  </p>
                </Card>
              )}

              {delivery && (
                <Card className="p-7">
                  <Eyebrow>Delivered output</Eyebrow>
                  <p className="mt-2 whitespace-pre-wrap rounded-xl bg-mist/45 p-4 text-[14px] leading-relaxed text-ink">
                    {delivery.output}
                  </p>
                  {delivery.notes && <p className="mt-3 text-sm text-slate">Operator notes: {delivery.notes}</p>}
                </Card>
              )}

              {reason && (
                <Card className="p-7">
                  <Eyebrow>AI verdict</Eyebrow>
                  <div className="mt-2 flex flex-wrap items-baseline gap-3">
                    <span className="headline text-[28px]">{reason.verdict}</span>
                    <span className="text-slate">score {scoreLabel(reason.scoreBps)}</span>
                    <span className="mono text-stone">{reason.modelId}</span>
                  </div>
                  <p className="mt-4 text-[15px] leading-relaxed text-slate">{reason.reason}</p>
                  {reason.rubricFindings.length > 0 && (
                    <ul className="mt-5 space-y-2">
                      {reason.rubricFindings.map((f) => (
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
            </div>

            <Card className="p-7">
              <Eyebrow>On-chain record</Eyebrow>
              <div className="mt-3">
                <Row label="Buyer">
                  <AddressLink address={order.data.buyer} />
                </Row>
                <Row label="Operator">
                  {order.data.operator === ZERO_ADDRESS ? (
                    <span className="text-stone">Unassigned</span>
                  ) : (
                    <AddressLink address={order.data.operator} />
                  )}
                </Row>
                <Row label="Escrow">{botAmount(order.data.price)}</Row>
                <Row label="Max slash">{botAmount(order.data.maxSlash)}</Row>
                <Row label="Deliver by">
                  {timestamp(order.data.deliveryDeadline)} · {relativeDeadline(order.data.deliveryDeadline, now)}
                </Row>
                <Row label="Verdict by">
                  {timestamp(order.data.verificationDeadline)} · {relativeDeadline(order.data.verificationDeadline, now)}
                </Row>
                {order.data.verdict !== "None" && (
                  <>
                    <Row label="Verdict">{order.data.verdict.toUpperCase()}</Row>
                    <Row label="Score">{scoreLabel(order.data.scoreBps)}</Row>
                  </>
                )}
              </div>

              <div className="mt-6">
                <Eyebrow>Committed hashes</Eyebrow>
                <div className="mt-2">
                  <Row label="jobSpecHash">
                    <Mono value={order.data.jobSpecHash} />
                  </Row>
                  <Row label="inputHash">
                    <Mono value={order.data.inputHash} />
                  </Row>
                  <Row label="rubricHash">
                    <Mono value={order.data.rubricHash} />
                  </Row>
                  <Row label="modelHash">
                    <Mono value={order.data.modelHash} />
                  </Row>
                  {order.data.outputHash !== ZERO_HASH && (
                    <Row label="outputHash">
                      <Mono value={order.data.outputHash} />
                    </Row>
                  )}
                  {order.data.verdictReasonHash !== ZERO_HASH && (
                    <Row label="reasonHash">
                      <Mono value={order.data.verdictReasonHash} />
                    </Row>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
    </Section>
  );
}

function ActionPanel({
  order,
  isOperator,
  now,
  onDone,
}: {
  order: NonNullable<ReturnType<typeof useOrder>["data"]>;
  isOperator: boolean;
  now: number;
  onDone: () => void;
}) {
  const {address} = useAccount();
  const {wrongNetwork} = useNetworkGate();
  const tx = useMetrxWrite();
  const action = nextAction(order, {address: address ?? null, isOperator}, now);

  const run = async () => {
    const map: Record<string, [string, unknown[]] | null> = {
      cancel: ["cancelOrder", [order.id]],
      accept: ["acceptOrder", [order.id]],
      "finalize-undelivered": ["finalizeUndelivered", [order.id]],
      "finalize-verifier-timeout": ["finalizeVerifierTimeout", [order.id]],
    };
    const call = map[action.kind];
    if (!call) return;
    const hash = await tx.send(call[0], call[1]);
    if (hash) onDone();
  };

  if (action.kind === "done") {
    return (
      <Notice tone={order.status === "Paid" ? "good" : "neutral"} title={`Settled as ${settlementWord(order.status)}`}>
        {settlementSentence(order)}
      </Notice>
    );
  }

  const linkActions: Record<string, {to: string; label: string}> = {
    "run-verifier": {to: `/app/verify/${order.id}`, label: action.label},
    deliver: {to: "/app/operator", label: "Go to the operator console"},
    "register-operator": {to: "/app/operator", label: action.label},
  };
  const link = linkActions[action.kind];

  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
      <div>
        <p className="text-[15px] font-medium text-ink">{action.label}</p>
        <p className="mt-1 max-w-2xl text-sm text-slate">{action.detail}</p>
        {tx.phase === "pending" && tx.hash && (
          <p className="mt-2 text-sm text-slate">
            Waiting for confirmation · <TxLink hash={tx.hash} />
          </p>
        )}
        <div className="mt-3">
          <ErrorNotice error={tx.error} />
        </div>
      </div>
      {action.kind === "wait" ? null : link ? (
        <Link to={link.to} className="btn btn-primary">
          {link.label}
        </Link>
      ) : (
        <button type="button" className="btn btn-primary" disabled={tx.busy || wrongNetwork} onClick={run}>
          {tx.busy ? "Working…" : action.label}
        </button>
      )}
    </Card>
  );
}

const settlementWord = (status: string) =>
  status === "Paid" ? "PAY" : status === "Slashed" ? "SLASH" : "REFUND";

function settlementSentence(order: NonNullable<ReturnType<typeof useOrder>["data"]>) {
  switch (order.status) {
    case "Paid":
      return `The AI verifier passed this output at ${scoreLabel(order.scoreBps)} and the contract released ${botAmount(order.price)} to the operator.`;
    case "Slashed":
      return order.verdict === "Fail"
        ? `The AI verifier failed this output at ${scoreLabel(order.scoreBps)}. The buyer received ${botAmount(order.price + order.maxSlash)}: the escrow plus the operator's slashed stake.`
        : `Nothing was delivered before the deadline. The buyer received ${botAmount(order.price + order.maxSlash)}: the escrow plus the operator's slashed stake.`;
    case "Refunded":
      return `The buyer was refunded ${botAmount(order.price)}. The operator's stake was released without penalty.`;
    case "Cancelled":
      return `The buyer cancelled before any operator committed and took back ${botAmount(order.price)}.`;
    default:
      return "";
  }
}
