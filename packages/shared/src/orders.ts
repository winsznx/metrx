import type {Address} from "viem";
import {ORDER_STATUS, VERDICT, isTerminal, type Order, type OperatorProfile} from "./types.js";

/** Raw tuple/struct shape returned by `getOrder`. */
type RawOrder = {
  buyer: Address;
  operator: Address;
  price: bigint;
  maxSlash: bigint;
  createdAt: bigint;
  acceptedAt: bigint;
  deliveryDeadline: bigint;
  verificationDeadline: bigint;
  jobSpecHash: `0x${string}`;
  inputHash: `0x${string}`;
  rubricHash: `0x${string}`;
  modelHash: `0x${string}`;
  outputHash: `0x${string}`;
  deliveryArtifactHash: `0x${string}`;
  verdictReasonHash: `0x${string}`;
  scoreBps: number;
  verdict: number;
  status: number;
  deliveredAt: bigint;
  evaluatedAt: bigint;
  settledAt: bigint;
};

export function decodeOrder(id: bigint, raw: RawOrder): Order {
  return {
    id,
    buyer: raw.buyer,
    operator: raw.operator,
    price: raw.price,
    maxSlash: raw.maxSlash,
    createdAt: raw.createdAt,
    acceptedAt: raw.acceptedAt,
    deliveryDeadline: raw.deliveryDeadline,
    verificationDeadline: raw.verificationDeadline,
    jobSpecHash: raw.jobSpecHash,
    inputHash: raw.inputHash,
    rubricHash: raw.rubricHash,
    modelHash: raw.modelHash,
    outputHash: raw.outputHash,
    deliveryArtifactHash: raw.deliveryArtifactHash,
    verdictReasonHash: raw.verdictReasonHash,
    scoreBps: Number(raw.scoreBps),
    verdict: VERDICT[Number(raw.verdict)] ?? "None",
    status: ORDER_STATUS[Number(raw.status)] ?? "None",
    deliveredAt: raw.deliveredAt,
    evaluatedAt: raw.evaluatedAt,
    settledAt: raw.settledAt,
  };
}

export function decodeOperator(raw: {
  owner: Address;
  stake: bigint;
  lockedStake: bigint;
  slashed: bigint;
  active: boolean;
  metadataURI: string;
}): OperatorProfile {
  return {...raw};
}

export const availableStake = (op: OperatorProfile) => op.stake - op.lockedStake;

/** The five lifecycle beats the UI renders as a timeline. */
export const LIFECYCLE_STEPS = ["Created", "Accepted", "Delivered", "AI verdict", "Settled"] as const;
export type LifecycleStep = (typeof LIFECYCLE_STEPS)[number];

export function lifecycleProgress(order: Order): {step: LifecycleStep; done: boolean; at: bigint | null}[] {
  const settled = order.settledAt > 0n;
  const hasVerdict = order.verdict !== "None";
  return [
    {step: "Created", done: true, at: order.createdAt},
    {step: "Accepted", done: order.acceptedAt > 0n, at: order.acceptedAt || null},
    {step: "Delivered", done: order.deliveredAt > 0n, at: order.deliveredAt || null},
    {step: "AI verdict", done: hasVerdict, at: hasVerdict ? order.evaluatedAt : null},
    {step: "Settled", done: settled, at: settled ? order.settledAt : null},
  ];
}

/**
 * The single action the connected wallet can take right now.
 * Every app surface derives its primary button from this, so the UI can never offer
 * an action the contract would reject.
 */
export type ActionKind =
  | "connect"
  | "wrong-network"
  | "register-operator"
  | "accept"
  | "deliver"
  | "run-verifier"
  | "submit-verdict"
  | "cancel"
  | "finalize-undelivered"
  | "finalize-verifier-timeout"
  | "wait"
  | "done";

export interface NextAction {
  kind: ActionKind;
  label: string;
  detail: string;
  actor: "buyer" | "operator" | "anyone" | "none";
}

export function nextAction(
  order: Order,
  viewer: {address: Address | null; isOperator: boolean; wrongNetwork?: boolean},
  now: number
): NextAction {
  if (isTerminal(order.status)) {
    return {kind: "done", label: "Settled", detail: "This order reached a terminal state.", actor: "none"};
  }
  if (!viewer.address) {
    return {
      kind: "connect",
      label: "Connect a wallet to act on this order",
      detail: "Reading is open to everyone. Moving funds needs a wallet on BOT Chain Mainnet.",
      actor: "none",
    };
  }
  if (viewer.wrongNetwork) {
    return {
      kind: "wrong-network",
      label: "Switch to BOT Chain Mainnet",
      detail: "Your wallet is on another network, so this order's actions are unavailable.",
      actor: "none",
    };
  }

  const isBuyer = !!viewer.address && viewer.address.toLowerCase() === order.buyer.toLowerCase();
  const isAssigned = !!viewer.address && viewer.address.toLowerCase() === order.operator.toLowerCase();
  const pastDelivery = now > Number(order.deliveryDeadline);
  const pastVerification = now > Number(order.verificationDeadline);

  switch (order.status) {
    case "Funded":
      if (pastDelivery) {
        return {
          kind: "finalize-undelivered",
          label: "Refund the buyer",
          detail: "The delivery deadline passed with no operator committed. Anyone can close this order.",
          actor: "anyone",
        };
      }
      if (isBuyer) {
        return {
          kind: "cancel",
          label: "Cancel and refund",
          detail: "No operator has committed yet, so you can pull the escrow back.",
          actor: "buyer",
        };
      }
      return viewer.isOperator
        ? {
            kind: "accept",
            label: "Accept this job",
            detail: "Locks your stake against the order's max slash until settlement.",
            actor: "operator",
          }
        : {
            kind: "register-operator",
            label: "Register as an operator",
            detail: "Stake native BOT to become eligible to accept this job.",
            actor: "operator",
          };

    case "Accepted":
      if (pastDelivery) {
        return {
          kind: "finalize-undelivered",
          label: "Refund and slash",
          detail: "Delivery deadline passed. The buyer is refunded and the operator's stake is slashed.",
          actor: "anyone",
        };
      }
      return isAssigned
        ? {
            kind: "deliver",
            label: "Submit delivery",
            detail: "Commits your output hash on-chain. The AI verifier can only judge this exact output.",
            actor: "operator",
          }
        : {
            kind: "wait",
            label: "Waiting on delivery",
            detail: "The operator is running the job.",
            actor: "none",
          };

    case "Delivered":
      if (pastVerification) {
        return {
          kind: "finalize-verifier-timeout",
          label: "Refund on verifier timeout",
          detail: "No signed verdict arrived in time. The buyer is refunded and the operator's stake is released.",
          actor: "anyone",
        };
      }
      return {
        kind: "run-verifier",
        label: "Run the AI verifier",
        detail: "Evaluates the delivered output against the buyer's rubric and signs a settlement certificate.",
        actor: "anyone",
      };

    default:
      return {kind: "done", label: "Settled", detail: "This order reached a terminal state.", actor: "none"};
  }
}
