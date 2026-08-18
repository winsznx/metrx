import {lifecycleProgress, type Order} from "@metrx/shared";
import {timestamp} from "@/lib/format";

/** Created → Accepted → Delivered → AI verdict → Settled, with the on-chain time for each beat. */
export function Timeline({order}: {order: Order}) {
  const steps = lifecycleProgress(order);
  const settledAs =
    order.status === "Paid"
      ? "PAY"
      : order.status === "Slashed"
        ? "SLASH"
        : order.status === "Refunded" || order.status === "Cancelled"
          ? "REFUND"
          : null;

  return (
    <ol className="flex flex-col gap-0 sm:flex-row sm:gap-0">
      {steps.map((s, i) => {
        const isLast = i === steps.length - 1;
        return (
          <li key={s.step} className="relative flex flex-1 gap-3 pb-6 sm:flex-col sm:pb-0">
            <div className="flex flex-col items-center sm:w-full sm:flex-row">
              <span
                className={`z-10 h-2.5 w-2.5 shrink-0 rounded-full ${
                  s.done ? "bg-ink" : "border border-ink/25 bg-paper"
                }`}
              />
              {!isLast && (
                <span
                  className={`w-px flex-1 sm:h-px sm:w-full ${s.done ? "bg-ink/35" : "bg-ink/12"}`}
                  aria-hidden="true"
                />
              )}
            </div>
            <div className="sm:mt-3 sm:pr-6">
              <p className={`text-sm ${s.done ? "text-ink" : "text-stone"}`}>
                {isLast && settledAs ? `Settled · ${settledAs}` : s.step}
              </p>
              <p className="mono mt-0.5 text-stone">{s.at ? timestamp(s.at) : "—"}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
