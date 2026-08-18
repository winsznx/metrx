/**
 * Executable specification of Metrx settlement.
 *
 * This model is written from the rules, not from the Solidity, and the contract test
 * suite asserts the same outcomes. When the two disagree, one of them is wrong and the
 * disagreement is the bug report. It is also what the UI uses to explain, ahead of a
 * transaction, exactly who gets paid and how much.
 */

export type Status = "Funded" | "Accepted" | "Delivered" | "Paid" | "Refunded" | "Slashed" | "Cancelled";

export const TERMINAL: Status[] = ["Paid", "Refunded", "Slashed", "Cancelled"];
export const isTerminal = (s: Status) => TERMINAL.includes(s);

export interface OrderState {
  status: Status;
  /** Native BOT held in escrow. */
  price: bigint;
  /** Operator stake that becomes slashable once the order is accepted. */
  maxSlash: bigint;
  /** Stake currently locked against this order. Zero until an operator accepts. */
  lockedStake: bigint;
  deliveryDeadline: number;
  verificationDeadline: number;
  deliveredAt: number | null;
}

export interface SettleAction {
  type: "settle";
  verdict: "PASS" | "FAIL";
  scoreBps: number;
  signedByVerifier: boolean;
  certificateMatchesOrder: boolean;
  evaluatedAt: number;
}

export type Action =
  | {type: "cancel"; caller: "buyer" | "operator" | "other"}
  | {type: "accept"; availableStake: bigint; registered: boolean}
  | {type: "deliver"; caller: "operator" | "other"; outputHash: string}
  | SettleAction
  | {type: "finalizeUndelivered"}
  | {type: "finalizeVerifierTimeout"};

export interface Transition {
  ok: boolean;
  /** Human-readable reason the action was rejected. Null on success. */
  error: string | null;
  status: Status;
  /** Net BOT the buyer receives from the contract. */
  buyerDelta: bigint;
  /** Net BOT the operator receives from the contract. */
  operatorDelta: bigint;
  /** Stake permanently taken from the operator. */
  slashed: bigint;
  /** Stake returned to the operator's spendable balance. */
  unlocked: bigint;
}

export const MAX_SCORE_BPS = 10_000;
export const MAX_CLOCK_SKEW = 15 * 60;

const reject = (state: OrderState, error: string): Transition => ({
  ok: false,
  error,
  status: state.status,
  buyerDelta: 0n,
  operatorDelta: 0n,
  slashed: 0n,
  unlocked: 0n,
});

const settle = (
  status: Status,
  {buyerDelta = 0n, operatorDelta = 0n, slashed = 0n, unlocked = 0n} = {} as Partial<
    Pick<Transition, "buyerDelta" | "operatorDelta" | "slashed" | "unlocked">
  >
): Transition => ({ok: true, error: null, status, buyerDelta, operatorDelta, slashed, unlocked});

export function transition(state: OrderState, action: Action, now: number): Transition {
  if (isTerminal(state.status)) return reject(state, `Order already settled as ${state.status}.`);

  switch (action.type) {
    case "cancel": {
      if (state.status !== "Funded") return reject(state, "Only a funded order with no operator can be cancelled.");
      if (action.caller !== "buyer") return reject(state, "Only the buyer can cancel their order.");
      return settle("Cancelled", {buyerDelta: state.price});
    }

    case "accept": {
      if (state.status !== "Funded") return reject(state, "Only a funded order can be accepted.");
      if (now >= state.deliveryDeadline) return reject(state, "The delivery window has already closed.");
      if (!action.registered) return reject(state, "Operator is not registered.");
      if (action.availableStake < state.maxSlash) {
        return reject(state, "Operator does not have enough unlocked stake to cover the max slash.");
      }
      return settle("Accepted");
    }

    case "deliver": {
      if (state.status !== "Accepted") return reject(state, "Only an accepted order can receive a delivery.");
      if (action.caller !== "operator") return reject(state, "Only the assigned operator can deliver.");
      if (now > state.deliveryDeadline) return reject(state, "The delivery deadline has passed.");
      if (!action.outputHash || /^0x0{64}$/.test(action.outputHash)) return reject(state, "Output hash is required.");
      return settle("Delivered");
    }

    case "settle": {
      if (state.status !== "Delivered") return reject(state, "A verdict can only settle a delivered order.");
      if (now > state.verificationDeadline) {
        return reject(state, "The verification window closed. Only a verifier-timeout refund is possible now.");
      }
      if (!action.signedByVerifier) return reject(state, "Certificate is not signed by the registered AI verifier.");
      if (!action.certificateMatchesOrder) {
        return reject(state, "Certificate does not cover this order's spec, rubric, model and output.");
      }
      if (action.scoreBps > MAX_SCORE_BPS) return reject(state, "Score must be between 0 and 10000 basis points.");
      if (action.evaluatedAt > now + MAX_CLOCK_SKEW) return reject(state, "Certificate is dated in the future.");
      if (state.deliveredAt !== null && action.evaluatedAt < state.deliveredAt) {
        return reject(state, "Certificate predates the delivery it claims to judge.");
      }

      return action.verdict === "PASS"
        ? settle("Paid", {operatorDelta: state.price, unlocked: state.lockedStake})
        : settleFail(state);
    }

    case "finalizeUndelivered": {
      if (state.status !== "Funded" && state.status !== "Accepted") {
        return reject(state, "Only a funded or accepted order can expire undelivered.");
      }
      if (now <= state.deliveryDeadline) return reject(state, "The delivery deadline has not passed yet.");
      return state.status === "Accepted"
        ? {...settleFail(state), status: "Slashed"}
        : settle("Refunded", {buyerDelta: state.price});
    }

    case "finalizeVerifierTimeout": {
      if (state.status !== "Delivered") return reject(state, "Only a delivered order can hit a verifier timeout.");
      if (now <= state.verificationDeadline) return reject(state, "The verification window is still open.");
      return settle("Refunded", {buyerDelta: state.price, unlocked: state.lockedStake});
    }
  }
}

function settleFail(state: OrderState): Transition {
  const slashed = state.maxSlash > state.lockedStake ? state.lockedStake : state.maxSlash;
  return settle("Slashed", {
    buyerDelta: state.price + slashed,
    slashed,
    unlocked: state.lockedStake - slashed,
  });
}

/** Value must be conserved: everything that leaves escrow plus stake is fully assigned. */
export function conserves(state: OrderState, t: Transition): boolean {
  if (!t.ok) return t.buyerDelta === 0n && t.operatorDelta === 0n && t.slashed === 0n && t.unlocked === 0n;
  const escrowOut = t.buyerDelta + t.operatorDelta;
  const stakeAccountedFor = t.slashed + t.unlocked;
  return escrowOut === state.price + t.slashed && stakeAccountedFor <= state.lockedStake;
}

/** Convenience: run a whole lifecycle and return every step for the UI's dry-run preview. */
export function simulate(
  initial: OrderState,
  steps: {action: Action; at: number}[]
): {state: OrderState; transitions: Transition[]} {
  let state = {...initial};
  const transitions: Transition[] = [];
  for (const {action, at} of steps) {
    const t = transition(state, action, at);
    transitions.push(t);
    if (!t.ok) continue;
    state = {
      ...state,
      status: t.status,
      lockedStake: action.type === "accept" ? state.maxSlash : state.lockedStake - t.slashed - t.unlocked,
      deliveredAt: action.type === "deliver" ? at : state.deliveredAt,
    };
  }
  return {state, transitions};
}
