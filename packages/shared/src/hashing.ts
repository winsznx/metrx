import {keccak256, toHex, type Hex} from "viem";

/**
 * Deterministic JSON serialisation.
 *
 * Object keys are sorted, arrays keep their order, and `undefined` members are dropped.
 * Both the browser and the verifier worker hash through this function, so a spec hashed
 * at order-creation time reproduces byte-for-byte at verification time.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export const hashJson = (value: unknown): Hex => keccak256(toHex(canonicalJson(value)));

export const hashText = (text: string): Hex => keccak256(toHex(text));

export const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

export const shortHash = (h: string, lead = 10, tail = 8) =>
  h.length <= lead + tail + 3 ? h : `${h.slice(0, lead)}…${h.slice(-tail)}`;
