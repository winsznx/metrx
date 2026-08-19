import {Link} from "react-router-dom";
import {useAccount} from "wagmi";
import {useMemo} from "react";
import {availableStake, type Order} from "@metrx/shared";
import {isRegistered, useBotBalance, useOperator, useOrders, useNow} from "@/lib/contract";
import {botAmount} from "@/lib/format";
import {Card, EmptyState, Eyebrow, Notice, Section, Spinner, Stat, StatusPill} from "@/components/primitives";
import type {FriendlyError} from "@/lib/errors";
import {AccountChangeBanner, ConnectButton, NetworkBanner, WalletSummary} from "@/components/Wallet";
import {DeployGate} from "@/components/DeployGate";

export default function Dashboard() {
  const {address, isConnected} = useAccount();
  const balance = useBotBalance();
  const orders = useOrders(60);
  const operator = useOperator(address);
  const now = useNow();

  const mine = useMemo(() => {
    if (!address) return {bought: [], operated: [], open: [] as Order[]};
    const lower = address.toLowerCase();
    const all = orders.data ?? [];
    return {
      bought: all.filter((o) => o.buyer.toLowerCase() === lower),
      operated: all.filter((o) => o.operator.toLowerCase() === lower),
      open: all.filter((o) => o.status === "Funded" && Number(o.deliveryDeadline) > now),
    };
  }, [orders.data, address, now]);

  return (
    <Section className="py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Metrx app</Eyebrow>
          <h1 className="headline mt-2 text-[38px]">
            {isConnected ? "Your settlement desk" : "Start with one role"}
          </h1>
        </div>
        <WalletSummary />
      </div>

      <div className="mt-8 space-y-4">
        <DeployGate>
          <NetworkBanner />
          <AccountChangeBanner />
        </DeployGate>
      </div>

      {!isConnected ? <RolePicker /> : null}

      {isConnected && (
        <>
          <div className="mt-10 grid gap-4 md:grid-cols-4">
            <Card>
              <Stat label="BOT balance" value={botAmount(balance)} />
            </Card>
            <Card>
              <Stat label="Orders you funded" value={mine.bought.length} />
            </Card>
            <Card>
              <Stat label="Orders you operated" value={mine.operated.length} />
            </Card>
            <Card>
              <Stat
                label="Operator stake"
                value={isRegistered(operator.data) ? botAmount(operator.data!.stake) : "Not registered"}
                sub={
                  isRegistered(operator.data)
                    ? `${botAmount(availableStake(operator.data!))} unlocked`
                    : "Stake BOT to accept jobs"
                }
              />
            </Card>
          </div>

          {mine.bought.length === 0 && mine.operated.length === 0 && !orders.loading && !orders.error && (
            <div className="mt-4">
              <Notice
                tone="neutral"
                title="New here?"
                action={
                  <Link to="/app/onboarding" className="btn btn-primary">
                    Open the checklist
                  </Link>
                }
              >
                A five-step checklist walks you through buying or selling your first compute job, and checks each step
                against your wallet as you go.
              </Notice>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/app/create" className="btn btn-primary">
              Create compute order
            </Link>
            <Link to="/app/operator" className="btn btn-ghost">
              {isRegistered(operator.data) ? "Operator console" : "Register / stake"}
            </Link>
            <Link to="/app/orders" className="btn btn-ghost">
              All your orders
            </Link>
          </div>

          <div className="mt-14 grid gap-10 lg:grid-cols-2">
            <OrderColumn
              title="Needs your attention"
              empty="Nothing is waiting on you right now."
              loading={orders.loading}
              error={orders.error}
              onRetry={orders.reload}
              orders={[...mine.bought, ...mine.operated].filter((o) =>
                ["Funded", "Accepted", "Delivered"].includes(o.status)
              )}
            />
            <OrderColumn
              title="Open jobs on the network"
              empty="No funded orders are waiting for an operator."
              loading={orders.loading}
              error={orders.error}
              onRetry={orders.reload}
              orders={mine.open}
            />
          </div>
        </>
      )}
    </Section>
  );
}

function RolePicker() {
  const roles = [
    {
      title: "I buy compute",
      body: "Fund a bounded job in native BOT, publish the rubric it must satisfy, and let the AI verifier decide whether it gets paid.",
      to: "/app/onboarding?role=buyer",
      cta: "Start as a buyer",
    },
    {
      title: "I operate compute",
      body: "Stake BOT, accept funded work, and get paid the full escrow the moment your output passes the buyer's rubric.",
      to: "/app/onboarding?role=operator",
      cta: "Start as an operator",
    },
    {
      title: "I verify proof",
      body: "Read any settled order end to end: the spec, the delivered output, the signed verdict, and the transaction that enforced it.",
      to: "/proof",
      cta: "Open the proof hub",
    },
  ];

  return (
    <>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {roles.map((r) => (
          <Card key={r.title} className="flex flex-col p-7">
            <h2 className="headline text-[22px]">{r.title}</h2>
            <p className="mt-2 flex-1 text-[15px] leading-relaxed text-slate">{r.body}</p>
            <Link to={r.to} className="btn btn-ghost mt-6 self-start">
              {r.cta}
            </Link>
          </Card>
        ))}
      </div>
      <div className="mt-8">
        <ConnectButton />
      </div>
    </>
  );
}

function OrderColumn({
  title,
  orders,
  empty,
  loading,
  error,
  onRetry,
}: {
  title: string;
  orders: Order[];
  empty: string;
  loading: boolean;
  error?: FriendlyError | null;
  onRetry?: () => void;
}) {
  const unique = Array.from(new Map(orders.map((o) => [o.id.toString(), o])).values());
  return (
    <div>
      <Eyebrow>{title}</Eyebrow>
      <div className="mt-4 space-y-2">
        {loading ? (
          <Spinner label="Reading BOT Chain…" />
        ) : error ? (
          <Notice
            tone="bad"
            title="Could not read BOT Chain"
            action={
              onRetry ? (
                <button type="button" className="btn btn-ghost" onClick={onRetry}>
                  Try again
                </button>
              ) : undefined
            }
          >
            {error.detail}
          </Notice>
        ) : unique.length === 0 ? (
          <EmptyState title={empty} />
        ) : (
          unique.map((o) => <OrderRow key={o.id.toString()} order={o} />)
        )}
      </div>
    </div>
  );
}

export function OrderRow({order}: {order: Order}) {
  return (
    <Link
      to={`/app/orders/${order.id}`}
      className="card flex items-center justify-between gap-4 p-4 transition-colors hover:border-ink/25"
    >
      <div className="min-w-0">
        <p className="mono text-stone">Order #{order.id.toString()}</p>
        <p className="truncate text-[15px] text-ink">{botAmount(order.price)}</p>
      </div>
      <StatusPill status={order.status} />
    </Link>
  );
}
