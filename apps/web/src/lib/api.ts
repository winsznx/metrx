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
  hashChecks: {label: string; onChain: Hex; recomputed: Hex | null; matches: boolean}[];
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {"content-type": "application/json", ...(init?.headers ?? {})},
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiRequestError(body.error ?? "http_error", body.message ?? `HTTP ${res.status}`, res.status);
  }
  return body as T;
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

  proof: (orderId: string | bigint) => request<ProofResponse>(`/api/proof/${orderId}`),

  proofIndex: (limit = 25) => request<ProofIndexResponse>(`/api/proof?limit=${limit}`),
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
