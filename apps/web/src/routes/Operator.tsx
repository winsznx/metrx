import {useMemo, useState} from "react";
import {Link} from "react-router-dom";
import {useAccount} from "wagmi";
import {availableStake, hashJson, hashText, type DeliveryArtifact, type Order} from "@metrx/shared";
import {api} from "@/lib/api";
import {isRegistered, useMetrxWrite, useNetworkGate, useNow, useOperator, useOrders} from "@/lib/contract";
import {botAmount, relativeDeadline, safeParseBot} from "@/lib/format";
import {humanError, type FriendlyError} from "@/lib/errors";
import {
  Card,
  EmptyState,
  ErrorNotice,
  Eyebrow,
  Field,
  Mono,
  Notice,
  Row,
  Section,
  Spinner,
  Stat,
  StatusPill,
  TxLink,
} from "@/components/primitives";
import {ConnectButton, NetworkBanner} from "@/components/Wallet";
import {DeployGate} from "@/components/DeployGate";

export default function Operator() {
  const {address, isConnected} = useAccount();
  const operator = useOperator(address);
  const orders = useOrders(60);
  const now = useNow();
  const registered = isRegistered(operator.data);

  const {open, accepted, history} = useMemo(() => {
    const all = orders.data ?? [];
    const lower = address?.toLowerCase();
    return {
      open: all.filter((o) => o.status === "Funded" && Number(o.deliveryDeadline) > now),
      accepted: all.filter((o) => o.operator.toLowerCase() === lower && ["Accepted", "Delivered"].includes(o.status)),
      history: all.filter((o) => o.operator.toLowerCase() === lower && ["Paid", "Slashed", "Refunded"].includes(o.status)),
    };
  }, [orders.data, address, now]);

  return (
    <Section className="py-14">
      <Eyebrow>Operator</Eyebrow>
      <h1 className="headline mt-2 text-[38px]">
        {registered ? "Operator console" : "Sell compute with something at stake"}
      </h1>

      <div className="mt-8 space-y-4">
        <DeployGate>
          <NetworkBanner />
          {!isConnected && (
            <Notice tone="neutral" title="Connect a wallet to register" action={<ConnectButton />}>
              Registration is a single transaction that posts your stake in native BOT.
            </Notice>
          )}
        </DeployGate>
      </div>

      {isConnected && (
        <>
          {operator.loading ? (
            <div className="mt-10">
              <Spinner label="Reading your operator record…" />
            </div>
          ) : registered ? (
            <StakePanel profile={operator.data!} onDone={operator.reload} />
          ) : (
            <RegisterPanel onDone={operator.reload} />
          )}

          <div className="mt-14 grid gap-10 lg:grid-cols-2">
            <div>
              <Eyebrow>Open funded jobs</Eyebrow>
              <p className="mt-1 text-sm text-slate">
                Accepting locks the order's max slash from your unlocked stake until settlement.
              </p>
              <div className="mt-4 space-y-2">
                {orders.loading ? (
                  <Spinner label="Reading BOT Chain…" />
                ) : open.length === 0 ? (
                  <EmptyState title="No open orders">
                    Nothing is funded and waiting for an operator at the moment.
                  </EmptyState>
                ) : (
                  open.map((o) => (
                    <JobCard key={o.id.toString()} order={o} registered={registered} profile={operator.data} onDone={() => {
                      orders.reload();
                      operator.reload();
                    }} />
                  ))
                )}
              </div>
            </div>

            <div>
              <Eyebrow>Your active work</Eyebrow>
              <p className="mt-1 text-sm text-slate">Deliver before the deadline or your stake is slashed.</p>
              <div className="mt-4 space-y-2">
                {accepted.length === 0 ? (
                  <EmptyState title="Nothing in flight" />
                ) : (
                  accepted.map((o) => (
                    <DeliverCard key={o.id.toString()} order={o} onDone={() => orders.reload()} />
                  ))
                )}
              </div>

              {history.length > 0 && (
                <div className="mt-10">
                  <Eyebrow>Settled history</Eyebrow>
                  <div className="mt-4 space-y-2">
                    {history.map((o) => (
                      <Link
                        key={o.id.toString()}
                        to={`/app/orders/${o.id}`}
                        className="card flex items-center justify-between p-4 transition-colors hover:border-ink/25"
                      >
                        <span className="mono text-stone">Order #{o.id.toString()}</span>
                        <span className="flex items-center gap-3 text-sm">
                          {o.status === "Paid" ? `+${botAmount(o.price)}` : `−${botAmount(o.maxSlash)}`}
                          <StatusPill status={o.status} />
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </Section>
  );
}

function RegisterPanel({onDone}: {onDone: () => void}) {
  const tx = useMetrxWrite();
  const {wrongNetwork} = useNetworkGate();
  const [stake, setStake] = useState("0.05");
  const [metadata, setMetadata] = useState("");
  const parsed = safeParseBot(stake);

  const register = async () => {
    if (!parsed.wei) return;
    const hash = await tx.send("registerOperator", [metadata.trim()], parsed.wei);
    if (hash) onDone();
  };

  return (
    <Card className="mt-10 p-7">
      <h2 className="headline text-[24px]">Register and stake</h2>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-slate">
        Your stake is what makes a Metrx order worth funding. When you accept an order, that order's max slash is locked
        from your unlocked stake. If you fail to deliver, or the AI verifier fails your output against the buyer's
        rubric, the locked amount is transferred to the buyer. Everything else stays yours and can be withdrawn at any
        time.
      </p>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <Field label="Initial stake in BOT" hint="Minimum 0.001 BOT. Stake more to accept larger orders." error={parsed.error}>
          <input className="field" value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Metadata URI" hint="Optional. A public pointer to who you are and what you run.">
          <input
            className="field"
            value={metadata}
            onChange={(e) => setMetadata(e.target.value)}
            placeholder="https://…"
            maxLength={200}
          />
        </Field>
      </div>

      <div className="mt-6 space-y-3">
        <ErrorNotice error={tx.error} />
        {tx.phase === "pending" && tx.hash && (
          <p className="text-sm text-slate">
            Waiting for confirmation · <TxLink hash={tx.hash} />
          </p>
        )}
        <button type="button" className="btn btn-primary" disabled={tx.busy || wrongNetwork || !parsed.wei} onClick={register}>
          {tx.busy ? "Working…" : `Register with ${botAmount(parsed.wei)}`}
        </button>
      </div>
    </Card>
  );
}

function StakePanel({profile, onDone}: {profile: NonNullable<ReturnType<typeof useOperator>["data"]>; onDone: () => void}) {
  const tx = useMetrxWrite();
  const {wrongNetwork} = useNetworkGate();
  const [amount, setAmount] = useState("0.01");
  const [mode, setMode] = useState<"add" | "withdraw">("add");
  const parsed = safeParseBot(amount);
  const unlocked = availableStake(profile);

  const submit = async () => {
    if (!parsed.wei) return;
    const hash =
      mode === "add"
        ? await tx.send("addStake", [], parsed.wei)
        : await tx.send("withdrawUnlockedStake", [parsed.wei]);
    if (hash) onDone();
  };

  return (
    <div className="mt-10 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Card className="grid gap-6 p-7 sm:grid-cols-3">
        <Stat label="Total stake" value={botAmount(profile.stake)} />
        <Stat label="Locked" value={botAmount(profile.lockedStake)} sub="Committed to live orders" />
        <Stat label="Slashed to date" value={botAmount(profile.slashed)} />
        <div className="sm:col-span-3">
          <Row label="Unlocked and withdrawable">{botAmount(unlocked)}</Row>
          {profile.metadataURI && <Row label="Metadata">{profile.metadataURI}</Row>}
        </div>
      </Card>

      <Card className="p-7">
        <div className="flex gap-2">
          {(["add", "withdraw"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`btn ${mode === m ? "btn-primary" : "btn-ghost"} px-4 py-1.5 text-[13px]`}
              onClick={() => setMode(m)}
            >
              {m === "add" ? "Add stake" : "Withdraw"}
            </button>
          ))}
        </div>
        <div className="mt-5">
          <Field
            label={mode === "add" ? "Amount to stake" : "Amount to withdraw"}
            hint={mode === "withdraw" ? `${botAmount(unlocked)} unlocked` : undefined}
            error={
              parsed.error ??
              (mode === "withdraw" && parsed.wei && parsed.wei > unlocked ? "That exceeds your unlocked stake." : null)
            }
          >
            <input className="field" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </Field>
        </div>
        <div className="mt-5 space-y-3">
          <ErrorNotice error={tx.error} />
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={tx.busy || wrongNetwork || !parsed.wei || (mode === "withdraw" && !!parsed.wei && parsed.wei > unlocked)}
            onClick={submit}
          >
            {tx.busy ? "Working…" : mode === "add" ? "Add stake" : "Withdraw"}
          </button>
        </div>
      </Card>
    </div>
  );
}

function JobCard({
  order,
  registered,
  profile,
  onDone,
}: {
  order: Order;
  registered: boolean;
  profile: ReturnType<typeof useOperator>["data"];
  onDone: () => void;
}) {
  const tx = useMetrxWrite();
  const {wrongNetwork} = useNetworkGate();
  const enoughStake = !!profile && availableStake(profile) >= order.maxSlash;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="mono text-stone">Order #{order.id.toString()}</span>
        <StatusPill status={order.status} />
      </div>
      <div className="mt-3">
        <Row label="Escrow">{botAmount(order.price)}</Row>
        <Row label="Stake at risk">{botAmount(order.maxSlash)}</Row>
        <Row label="Deliver by">{relativeDeadline(order.deliveryDeadline)}</Row>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!registered || !enoughStake || tx.busy || wrongNetwork}
          onClick={async () => {
            const hash = await tx.send("acceptOrder", [order.id]);
            if (hash) onDone();
          }}
        >
          {tx.busy ? "Working…" : "Accept job"}
        </button>
        <Link to={`/app/orders/${order.id}`} className="text-sm text-slate underline underline-offset-2 hover:text-ink">
          Read the spec first
        </Link>
      </div>
      {registered && !enoughStake && (
        <p className="mt-3 text-sm text-clay">
          You need {botAmount(order.maxSlash)} unlocked to accept this. Add stake above.
        </p>
      )}
      <ErrorNotice error={tx.error} />
    </Card>
  );
}

function DeliverCard({order, onDone}: {order: Order; onDone: () => void}) {
  const tx = useMetrxWrite();
  const {wrongNetwork} = useNetworkGate();
  const [output, setOutput] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);

  if (order.status === "Delivered") {
    return (
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <span className="mono text-stone">Order #{order.id.toString()}</span>
          <StatusPill status={order.status} />
        </div>
        <p className="mt-3 text-sm text-slate">
          Delivered. The AI verifier can be run by anyone, including you, until{" "}
          {relativeDeadline(order.verificationDeadline)}.
        </p>
        <Link to={`/app/verify/${order.id}`} className="btn btn-primary mt-4">
          Run the AI verifier
        </Link>
      </Card>
    );
  }

  const submit = async () => {
    const text = output.trim();
    if (!text) return;
    setError(null);
    setBusy(true);
    try {
      const artifact: DeliveryArtifact = {
        orderId: order.id.toString(),
        output: text,
        notes: notes.trim() || undefined,
        submittedAt: Math.floor(Date.now() / 1000),
      };
      const published = await api.publishDelivery(artifact);
      if (published.hash.toLowerCase() !== hashJson(artifact).toLowerCase()) {
        throw new Error("The published delivery did not reproduce its hash. Nothing was submitted.");
      }
      setBusy(false);
      const hash = await tx.send("submitDelivery", [order.id, hashText(text), published.hash]);
      if (hash) onDone();
    } catch (e) {
      setBusy(false);
      setError(humanError(e));
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="mono text-stone">Order #{order.id.toString()}</span>
        <StatusPill status={order.status} />
      </div>
      <p className="mt-2 text-sm text-slate">Deliver by {relativeDeadline(order.deliveryDeadline)}.</p>
      <div className="mt-4">
        <Field label="Your output" hint="Committed on-chain as outputHash. The verifier judges this exact text.">
          <textarea
            className="field min-h-32"
            value={output}
            onChange={(e) => setOutput(e.target.value)}
            maxLength={20_000}
            placeholder="Paste the result of the job…"
          />
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Notes" hint="Optional. Published alongside the output.">
          <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={400} />
        </Field>
      </div>
      {output.trim() && (
        <p className="mt-3 text-xs text-stone">
          outputHash <Mono value={hashText(output.trim())} copy={false} />
        </p>
      )}
      <div className="mt-4 space-y-3">
        <ErrorNotice error={error ?? tx.error} />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!output.trim() || busy || tx.busy || wrongNetwork}
          onClick={submit}
        >
          {busy || tx.busy ? "Working…" : "Submit delivery"}
        </button>
      </div>
    </Card>
  );
}
