import {formatEther, parseEther} from "viem";

export const shortAddress = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

export const shortHash = (h?: string | null, lead = 10, tail = 6) =>
  !h ? "—" : h.length <= lead + tail + 1 ? h : `${h.slice(0, lead)}…${h.slice(-tail)}`;

/** Trims trailing zeros so 1.500000 BOT reads as 1.5 BOT. */
export function formatBot(wei: bigint | undefined | null, maxDecimals = 4): string {
  if (wei === undefined || wei === null) return "—";
  const full = formatEther(wei);
  const [whole, frac = ""] = full.split(".");
  const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole!;
}

export const botAmount = (wei: bigint | undefined | null, maxDecimals = 4) => `${formatBot(wei, maxDecimals)} BOT`;

export function safeParseBot(value: string): {wei: bigint | null; error: string | null} {
  const trimmed = value.trim();
  if (!trimmed) return {wei: null, error: "Enter an amount."};
  if (!/^\d*\.?\d*$/.test(trimmed)) return {wei: null, error: "Use digits and a single decimal point."};
  try {
    const wei = parseEther(trimmed as `${number}`);
    if (wei <= 0n) return {wei: null, error: "Amount must be greater than zero."};
    return {wei, error: null};
  } catch {
    return {wei: null, error: "That amount is not a valid BOT value."};
  }
}

export const scoreLabel = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

export function timestamp(seconds: bigint | number | null | undefined): string {
  const s = Number(seconds ?? 0);
  if (!s) return "—";
  return new Date(s * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function relativeDeadline(deadline: bigint | number, now = Math.floor(Date.now() / 1000)): string {
  const delta = Number(deadline) - now;
  const abs = Math.abs(delta);
  const unit = abs < 60 ? [abs, "sec"] : abs < 3600 ? [abs / 60, "min"] : abs < 86_400 ? [abs / 3600, "hr"] : [abs / 86_400, "day"];
  const value = Math.round(unit[0] as number);
  const noun = `${unit[1]}${value === 1 ? "" : "s"}`;
  return delta >= 0 ? `in ${value} ${noun}` : `${value} ${noun} ago`;
}

/** Turns a duration picker value into an absolute unix deadline. */
export const inSeconds = (minutes: number) => BigInt(Math.floor(Date.now() / 1000) + Math.round(minutes * 60));
