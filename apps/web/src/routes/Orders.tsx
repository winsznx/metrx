import {useMemo, useState} from "react";
import {useAccount} from "wagmi";
import {Link} from "react-router-dom";
import type {Order, OrderStatus} from "@metrx/shared";
import {useOrders} from "@/lib/contract";
import {botAmount, relativeDeadline, timestamp} from "@/lib/format";
import {Card, EmptyState, Eyebrow, Notice, Section, Spinner, StatusPill} from "@/components/primitives";
import {ConnectButton} from "@/components/Wallet";
import {DeployGate} from "@/components/DeployGate";

type Filter = "all" | "buying" | "operating";

export default function Orders() {
  const {address, isConnected} = useAccount();
  const orders = useOrders(100);
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(() => {
    const all = orders.data ?? [];
    const lower = address?.toLowerCase();
    if (!lower || filter === "all") return all;
    return all.filter((o) =>
      filter === "buying" ? o.buyer.toLowerCase() === lower : o.operator.toLowerCase() === lower
    );
  }, [orders.data, address, filter]);

  return (
    <Section className="py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Orders</Eyebrow>
          <h1 className="headline mt-2 text-[38px]">Every order on Metrx</h1>
        </div>
        <div className="flex gap-2">
          {(["all", "buying", "operating"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              disabled={f !== "all" && !isConnected}
              className={`btn ${filter === f ? "btn-primary" : "btn-ghost"} px-4 py-1.5 text-[13px]`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "buying" ? "I funded" : "I operated"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <DeployGate>
          {!isConnected && (
            <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
              <p className="text-sm text-slate">
                Connect a wallet to filter down to the orders you funded or operated.
              </p>
              <ConnectButton />
            </Card>
          )}
        </DeployGate>
      </div>

      <div className="mt-8">
        {orders.loading ? (
          <Spinner label="Reading BOT Chain…" />
        ) : orders.error ? (
          <div className="space-y-3">
            <Notice tone="bad" title="Could not read BOT Chain">
              {orders.error.detail} This is a connection problem, not a statement about the contract.
            </Notice>
            <button type="button" className="btn btn-ghost" onClick={orders.reload}>
              Try again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No orders yet">
            {filter === "all"
              ? "Nothing has been funded on this contract yet."
              : "Nothing matches this filter for the connected wallet."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink/12 text-left">
                  {["Order", "Escrow", "Stake at risk", "Created", "Next deadline", "State"].map((h) => (
                    <th key={h} className="eyebrow py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <OrderTableRow key={o.id.toString()} order={o} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}

const OPEN_STATES: OrderStatus[] = ["Funded", "Accepted", "Delivered"];

function OrderTableRow({order}: {order: Order}) {
  const deadline =
    order.status === "Delivered" ? order.verificationDeadline : order.deliveryDeadline;

  return (
    <tr className="border-b border-ink/8 last:border-0">
      <td className="py-3.5">
        <Link className="mono text-ink underline decoration-ink/20 underline-offset-2" to={`/app/orders/${order.id}`}>
          #{order.id.toString()}
        </Link>
      </td>
      <td className="py-3.5">{botAmount(order.price)}</td>
      <td className="py-3.5 text-slate">{botAmount(order.maxSlash)}</td>
      <td className="py-3.5 text-slate">{timestamp(order.createdAt)}</td>
      <td className="py-3.5 text-slate">
        {OPEN_STATES.includes(order.status) ? relativeDeadline(deadline) : "—"}
      </td>
      <td className="py-3.5">
        <StatusPill status={order.status} />
      </td>
    </tr>
  );
}
