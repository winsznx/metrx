import type {Address, Hex} from "viem";

// ---------------------------------------------------------------------------
// On-chain enums — index order must match MetrxCore.sol exactly.
// ---------------------------------------------------------------------------

export const ORDER_STATUS = [
  "None",
  "Funded",
  "Accepted",
  "Delivered",
  "Paid",
  "Refunded",
  "Slashed",
  "Cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

export const VERDICT = ["None", "Pass", "Fail"] as const;
export type VerdictName = (typeof VERDICT)[number];

export const TERMINAL_STATUSES: OrderStatus[] = ["Paid", "Refunded", "Slashed", "Cancelled"];
export const isTerminal = (s: OrderStatus) => TERMINAL_STATUSES.includes(s);

/** Settlement outcome as the product speaks about it. */
export type Outcome = "PAY" | "REFUND" | "SLASH" | "PENDING";

export function outcomeOf(status: OrderStatus): Outcome {
  switch (status) {
    case "Paid":
      return "PAY";
    case "Refunded":
    case "Cancelled":
      return "REFUND";
    case "Slashed":
      return "SLASH";
    default:
      return "PENDING";
  }
}

// ---------------------------------------------------------------------------
// Decoded contract structs
// ---------------------------------------------------------------------------

export interface Order {
  id: bigint;
  buyer: Address;
  operator: Address;
  price: bigint;
  maxSlash: bigint;
  createdAt: bigint;
  acceptedAt: bigint;
  deliveryDeadline: bigint;
  verificationDeadline: bigint;
  jobSpecHash: Hex;
  inputHash: Hex;
  rubricHash: Hex;
  modelHash: Hex;
  outputHash: Hex;
  deliveryArtifactHash: Hex;
  verdictReasonHash: Hex;
  scoreBps: number;
  verdict: VerdictName;
  status: OrderStatus;
  deliveredAt: bigint;
  evaluatedAt: bigint;
  settledAt: bigint;
}

export interface OperatorProfile {
  owner: Address;
  stake: bigint;
  lockedStake: bigint;
  slashed: bigint;
  active: boolean;
  metadataURI: string;
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

/** What the buyer publishes when funding an order. Hashed canonically and committed on-chain. */
export interface JobSpec {
  title: string;
  taskType: "text-eval";
  instructions: string;
  input: string;
  rubric: string[];
  modelId: string;
}

/** What the operator publishes when delivering. */
export interface DeliveryArtifact {
  orderId: string;
  output: string;
  notes?: string;
  submittedAt: number;
}

/** The AI verifier's public reasoning, hashed into `verdictReasonHash`. */
export interface VerifierReason {
  orderId: string;
  verdict: "PASS" | "FAIL";
  scoreBps: number;
  reason: string;
  rubricFindings: {rubricIndex: number; satisfied: boolean; note: string}[];
  modelId: string;
  evaluatedAt: number;
  /** Which backend produced this verdict, and whether it was the deterministic stand-in. */
  provider?: string;
  mocked?: boolean;
}
