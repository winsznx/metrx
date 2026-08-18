import type {ReactNode} from "react";
import {useState} from "react";
import {explorerAddress, explorerTx, type OrderStatus} from "@metrx/shared";
import {shortAddress, shortHash} from "@/lib/format";
import type {FriendlyError} from "@/lib/errors";

export function Section({
  children,
  className = "",
  width = "wide",
}: {
  children: ReactNode;
  className?: string;
  width?: "wide" | "narrow";
}) {
  return (
    <section className={className}>
      <div className={`mx-auto px-6 ${width === "narrow" ? "max-w-3xl" : "max-w-[1180px]"}`}>{children}</div>
    </section>
  );
}

export function Eyebrow({children}: {children: ReactNode}) {
  return <p className="eyebrow">{children}</p>;
}

export function Card({children, className = ""}: {children: ReactNode; className?: string}) {
  return <div className={`card p-6 ${className}`}>{children}</div>;
}

/** Settlement state is the one place colour is spent, so a badge always carries meaning. */
export function StatusPill({status}: {status: OrderStatus}) {
  const map: Record<OrderStatus, {label: string; className: string}> = {
    None: {label: "Unknown", className: "bg-mist text-slate"},
    Funded: {label: "Funded", className: "bg-mist text-ink"},
    Accepted: {label: "Accepted", className: "bg-mist text-ink"},
    Delivered: {label: "Delivered", className: "bg-amber/20 text-[#7a5518]"},
    Paid: {label: "PAY", className: "bg-bot/18 text-deep"},
    Refunded: {label: "REFUND", className: "bg-slate/12 text-slate"},
    Slashed: {label: "SLASH", className: "bg-clay/14 text-clay"},
    Cancelled: {label: "Cancelled", className: "bg-slate/12 text-slate"},
  };
  const {label, className} = map[status];
  return <span className={`pill ${className}`}>{label}</span>;
}

export function Chip({children, tone = "neutral"}: {children: ReactNode; tone?: "neutral" | "good" | "warn"}) {
  const tones = {
    neutral: "border-ink/15 text-slate",
    good: "border-bot/40 text-deep",
    warn: "border-amber/50 text-[#7a5518]",
  };
  return <span className={`pill border ${tones[tone]} bg-transparent`}>{children}</span>;
}

/** Hashes are the evidence, so they are always copyable and always monospaced. */
export function Mono({
  value,
  href,
  lead = 10,
  tail = 6,
  copy = true,
}: {
  value: string;
  href?: string;
  lead?: number;
  tail?: number;
  copy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const label = shortHash(value, lead, tail);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      {href ? (
        <a className="mono text-ink underline decoration-ink/25 underline-offset-2 hover:decoration-ink" href={href} target="_blank" rel="noreferrer">
          {label}
        </a>
      ) : (
        <span className="mono text-ink">{label}</span>
      )}
      {copy && (
        <button
          type="button"
          onClick={onCopy}
          className="text-[11px] text-stone hover:text-ink"
          aria-label={`Copy ${value}`}
        >
          {copied ? "copied" : "copy"}
        </button>
      )}
    </span>
  );
}

export const AddressLink = ({address}: {address: string}) => (
  <a
    className="mono text-ink underline decoration-ink/25 underline-offset-2 hover:decoration-ink"
    href={explorerAddress(address)}
    target="_blank"
    rel="noreferrer"
  >
    {shortAddress(address)}
  </a>
);

export const TxLink = ({hash, label}: {hash: string; label?: string}) => (
  <a
    className="mono text-ink underline decoration-ink/25 underline-offset-2 hover:decoration-ink"
    href={explorerTx(hash)}
    target="_blank"
    rel="noreferrer"
  >
    {label ?? shortHash(hash)}
  </a>
);

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs text-clay">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-stone">{hint}</span>
      ) : null}
    </label>
  );
}

export function Notice({
  tone = "neutral",
  title,
  children,
  action,
}: {
  tone?: "neutral" | "warn" | "bad" | "good";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    neutral: "border-ink/12 bg-mist/40",
    warn: "border-amber/40 bg-amber/10",
    bad: "border-clay/30 bg-clay/8",
    good: "border-bot/35 bg-bot/10",
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink">{title}</p>
          {children && <div className="mt-1 text-sm text-slate">{children}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}

export const ErrorNotice = ({error}: {error: FriendlyError | null}) =>
  error ? (
    <Notice tone={error.benign ? "neutral" : "bad"} title={error.title}>
      {error.detail}
    </Notice>
  ) : null;

export function Stat({label, value, sub}: {label: string; value: ReactNode; sub?: ReactNode}) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="headline mt-1.5 text-[28px]">{value}</p>
      {sub && <p className="mt-0.5 text-sm text-stone">{sub}</p>}
    </div>
  );
}

export function Row({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/8 py-2.5 last:border-0">
      <span className="text-sm text-stone">{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

export function Spinner({label}: {label: string}) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-ink/25 border-t-ink" />
      {label}
    </span>
  );
}

export function EmptyState({title, children}: {title: string; children?: ReactNode}) {
  return (
    <div className="rounded-2xl border border-dashed border-ink/15 p-10 text-center">
      <p className="headline text-lg">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-slate">{children}</div>}
    </div>
  );
}
