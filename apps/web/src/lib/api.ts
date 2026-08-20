import type {Address, Hex} from "viem";
import type {DeliveryArtifact, JobSpec, VerifierReason} from "@metrx/shared";
import {API_BASE} from "./config";

export interface VerifierConfig {
  chainId: number;
  contract: string | null;
  totalOrders: string;
  verifier: {
    provider: string;
    modelId: string;
    modelHash: Hex;
    signerAddress: Address | null;
    onChainVerifier: Address | null;
    signerMatchesContract: boolean;
    canSign: boolean;
    mocked: boolean;
    schemaEnforced: boolean;
  };
  artifactStore: "r2" | "kv" | "memory";
}

export interface RateLimitSnapshot {
  requestsRemaining: string | null;
  tokensRemaining: string | null;
  requestsReset: string | null;
  tokensReset: string | null;
}

export interface SignedVerdictResponse {
  orderId: string;
  verdict: "PASS" | "FAIL";
  scoreBps: number;
  reason: string;
  reasonHash: Hex;
  rubricFindings: {rubricIndex: number; satisfied: boolean; note: string}[];
  modelId: string;
  modelHash: Hex;
  provider: string;
  mocked: boolean;
  rateLimit: RateLimitSnapshot | null;
  evaluatedAt: number;
  signature: Hex;
  digest: Hex;
  verifierAddress: Address;
  typedData: {
    domain: {name: string; version: string; chainId: number; verifyingContract: Address};
    types: Record<string, {name: string; type: string}[]>;
    primaryType: string;
    message: Record<string, string | number>;
  };
  reasonArtifact: VerifierReason;
  submit: {address: Address; functionName: string; args: [string, number, number, Hex, number, Hex]};
}

export interface TimelineEntry {
  event: string;
  label: string;
  txHash: Hex;
  blockNumber: string;
  timestamp: number | null;
  explorer: string;
}

export interface ProofResponse {
  orderId: string;
  chainId: number;
  contract: Address;
  aiVerifier: Address;
  order: Record<string, string>;
  outcome: "PAY" | "REFUND" | "SLASH" | "PENDING";
  jobSpec: JobSpec | null;
  delivery: DeliveryArtifact | null;
  reason: VerifierReason | null;
  hashChecks: {label: string; onChain: Hex; recomputed: Hex | null; matches: boolean; artifactUrl: string}[];
  certificate: {
    signature: Hex;
    digest: Hex;
    verifierAddress: Address;
    evaluatedAt: number;
    typedData: {domain: Record<string, string | number>; types: Record<string, {name: string; type: string}[]>; primaryType: string; message: Record<string, string | number>};
  } | null;
  timeline: TimelineEntry[];
  settlementTx: Hex | null;
  explorer: {contract: string; buyer: string; operator: string; verifier: string};
  generatedAt: number;
}

export interface ProofIndexResponse {
  contract: Address;
  aiVerifier: Address;
  counts: {total: number; paid: number; slashed: number; refunded: number};
  orders: Record<string, string>[];
}

/** Surfaces the API's own error code so `humanError` can map it. */
export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(`${code}: ${message}`);
  }
}

/**
 * `content-type` is set only when there is a body to describe. Declaring it on a GET is not
 * merely redundant: `application/json` is outside the CORS safelist, so it forces a preflight
 * OPTIONS on every read, which doubled the request count on page load and made reads fail in bursts.
 *
 * A 5xx or a dropped connection is retried with a short jittered backoff. A cold free-tier isolate
 * that overruns its CPU budget is killed by the platform (Cloudflare 1101) before the handler runs,
 * and that kill is transient: a retry lands on a now-warm isolate and succeeds, so it never needs to
 * reach the UI. The jitter keeps a burst of simultaneous failures from retrying in lockstep and
 * colliding again. A 4xx is deterministic, so it is surfaced immediately without spending a retry.
 */
const RETRY_BACKOFF_MS = [300, 800];

const backoffFor = (attempt: number): number => {
  const base = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
  return base + Math.floor(Math.random() * base);
};

const parseJsonObject = (text: string): Record<string, unknown> => {
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // A platform 1101 kill answers with a plain-text body, so parsing it as JSON must read as an
    // empty object rather than throw a SyntaxError that masks the real status.
    return {};
  }
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined;
  const headers = {...(hasBody ? {"content-type": "application/json"} : {}), ...(init?.headers ?? {})};

  let lastError: unknown = new ApiRequestError("network", "The request failed before a response arrived.", 0);

  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, backoffFor(attempt)));

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {...init, headers});
    } catch (err) {
      lastError = err;
      continue;
    }

    if (res.status >= 500 && attempt < RETRY_BACKOFF_MS.length) {
      lastError = new ApiRequestError("upstream", `HTTP ${res.status}`, res.status);
      continue;
    }

    const body = parseJsonObject(await res.text());
    if (!res.ok) {
      const code = typeof body.error === "string" ? body.error : "http_error";
      const message = typeof body.message === "string" ? body.message : `HTTP ${res.status}`;
      throw new ApiRequestError(code, message, res.status);
    }
    return body as T;
  }

  throw lastError;
}

export const api = {
  config: () => request<VerifierConfig>("/api/config"),

  publishJobSpec: (spec: JobSpec) =>
    request<{hash: Hex}>("/api/artifacts", {
      method: "POST",
      body: JSON.stringify({kind: "job-spec", content: spec}),
    }),

  publishDelivery: (artifact: DeliveryArtifact) =>
    request<{hash: Hex}>("/api/artifacts", {
      method: "POST",
      body: JSON.stringify({kind: "delivery", content: artifact}),
    }),

  artifact: (hash: string) => request<{hash: Hex; kind: string; body: string}>(`/api/artifacts/${hash}`),

  runVerifier: (orderId: string | bigint) =>
    request<SignedVerdictResponse>(`/api/verify/${orderId}`, {method: "POST", body: "{}"}),

  /** A certificate already signed for this order, so a reload never forces a fresh model run. */
  existingVerdict: (orderId: string | bigint) =>
    request<SignedVerdictResponse>(`/api/verify/${orderId}`).catch(() => null),

  proof: (orderId: string | bigint) => request<ProofResponse>(`/api/proof/${orderId}`),

  timeline: (orderId: string | bigint) =>
    request<ProofResponse>(`/api/proof/${orderId}`).then((p) => p.timeline),

  proofIndex: (limit = 25) => request<ProofIndexResponse>(`/api/proof?limit=${limit}`),

  operators: () =>
    request<{
      count: number;
      activeCount: number;
      maxAvailableStake: string;
      totalStake: string;
      operators: {address: string; available: string; stake: string; slashed: string; active: boolean; metadataURI: string}[];
    }>("/api/operators"),

  previewVerdict: (jobSpec: JobSpec, output: string) =>
    request<{
      verdict: "PASS" | "FAIL";
      scoreBps: number;
      reason: string;
      rubricFindings: {rubricIndex: number; satisfied: boolean; note: string}[];
      modelId: string;
      mocked: boolean;
    }>("/api/preview", {method: "POST", body: JSON.stringify({jobSpec, output})}),
};

/** Reads a published artifact and parses it, or returns null when it was never published. */
export async function readArtifact<T>(hash: string | null | undefined): Promise<T | null> {
  if (!hash || /^0x0{64}$/.test(hash)) return null;
  try {
    const record = await api.artifact(hash);
    return JSON.parse(record.body) as T;
  } catch {
    return null;
  }
}
