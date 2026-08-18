import {describe, expect, it} from "vitest";
import {
  conserves,
  isTerminal,
  simulate,
  transition,
  type Action,
  type OrderState,
  type SettleAction,
} from "../src/settlementModel.js";

const T0 = 1_800_000_000;
const PRICE = 1_000_000_000_000_000_000n; // 1 BOT
const MAX_SLASH = 500_000_000_000_000_000n; // 0.5 BOT

const funded = (over: Partial<OrderState> = {}): OrderState => ({
  status: "Funded",
  price: PRICE,
  maxSlash: MAX_SLASH,
  lockedStake: 0n,
  deliveryDeadline: T0 + 3600,
  verificationDeadline: T0 + 7200,
  deliveredAt: null,
  ...over,
});

const accepted = (over: Partial<OrderState> = {}) => funded({status: "Accepted", lockedStake: MAX_SLASH, ...over});
const delivered = (over: Partial<OrderState> = {}) =>
  funded({status: "Delivered", lockedStake: MAX_SLASH, deliveredAt: T0 + 60, ...over});

const goodCert = (verdict: "PASS" | "FAIL", at = T0 + 120): SettleAction => ({
  type: "settle",
  verdict,
  scoreBps: verdict === "PASS" ? 9200 : 1500,
  signedByVerifier: true,
  certificateMatchesOrder: true,
  evaluatedAt: at,
});

describe("accept", () => {
  it("locks stake when the operator can cover the max slash", () => {
    const t = transition(funded(), {type: "accept", availableStake: MAX_SLASH, registered: true}, T0);
    expect(t.ok).toBe(true);
    expect(t.status).toBe("Accepted");
  });

  it("rejects an operator without enough unlocked stake", () => {
    const t = transition(funded(), {type: "accept", availableStake: MAX_SLASH - 1n, registered: true}, T0);
    expect(t.ok).toBe(false);
    expect(t.error).toMatch(/unlocked stake/);
  });

  it("rejects an unregistered operator", () => {
    const t = transition(funded(), {type: "accept", availableStake: MAX_SLASH, registered: false}, T0);
    expect(t.ok).toBe(false);
  });

  it("rejects acceptance after the delivery deadline", () => {
    const t = transition(funded(), {type: "accept", availableStake: MAX_SLASH, registered: true}, T0 + 3601);
    expect(t.ok).toBe(false);
    expect(t.error).toMatch(/delivery window/);
  });
});

describe("deliver", () => {
  it("accepts a delivery from the assigned operator inside the window", () => {
    const t = transition(accepted(), {type: "deliver", caller: "operator", outputHash: "0xabc"}, T0 + 100);
    expect(t.status).toBe("Delivered");
  });

  it("rejects a delivery from anyone else", () => {
    const t = transition(accepted(), {type: "deliver", caller: "other", outputHash: "0xabc"}, T0 + 100);
    expect(t.ok).toBe(false);
  });

  it("rejects a late delivery", () => {
    const t = transition(accepted(), {type: "deliver", caller: "operator", outputHash: "0xabc"}, T0 + 3601);
    expect(t.ok).toBe(false);
    expect(t.error).toMatch(/deadline has passed/);
  });

  it("rejects an empty output hash", () => {
    const t = transition(accepted(), {type: "deliver", caller: "operator", outputHash: `0x${"0".repeat(64)}`}, T0);
    expect(t.ok).toBe(false);
  });
});

describe("settle with an AI verdict", () => {
  it("PASS pays the operator and releases the stake", () => {
    const state = delivered();
    const t = transition(state, goodCert("PASS"), T0 + 120);
    expect(t.status).toBe("Paid");
    expect(t.operatorDelta).toBe(PRICE);
    expect(t.buyerDelta).toBe(0n);
    expect(t.slashed).toBe(0n);
    expect(t.unlocked).toBe(MAX_SLASH);
    expect(conserves(state, t)).toBe(true);
  });

  it("FAIL refunds the buyer and slashes the operator", () => {
    const state = delivered();
    const t = transition(state, goodCert("FAIL"), T0 + 120);
    expect(t.status).toBe("Slashed");
    expect(t.buyerDelta).toBe(PRICE + MAX_SLASH);
    expect(t.operatorDelta).toBe(0n);
    expect(t.slashed).toBe(MAX_SLASH);
    expect(t.unlocked).toBe(0n);
    expect(conserves(state, t)).toBe(true);
  });

  it("rejects a certificate that is not signed by the AI verifier", () => {
    const t = transition(delivered(), {...goodCert("PASS"), signedByVerifier: false}, T0 + 120);
    expect(t.ok).toBe(false);
    expect(t.error).toMatch(/AI verifier/);
  });

  it("rejects a certificate bound to different hashes", () => {
    const t = transition(delivered(), {...goodCert("PASS"), certificateMatchesOrder: false}, T0 + 120);
    expect(t.ok).toBe(false);
    expect(t.error).toMatch(/does not cover/);
  });

  it("rejects a score above 10000 bps", () => {
    const t = transition(delivered(), {...goodCert("PASS"), scoreBps: 10_001}, T0 + 120);
    expect(t.ok).toBe(false);
  });

  it("rejects a certificate dated before the delivery it judges", () => {
    const t = transition(delivered(), goodCert("PASS", T0 + 30), T0 + 120);
    expect(t.ok).toBe(false);
    expect(t.error).toMatch(/predates/);
  });

  it("rejects a certificate dated far in the future", () => {
    const t = transition(delivered(), goodCert("PASS", T0 + 3000), T0 + 120);
    expect(t.ok).toBe(false);
    expect(t.error).toMatch(/future/);
  });

  it("rejects a verdict before delivery", () => {
    const t = transition(accepted(), goodCert("PASS"), T0 + 120);
    expect(t.ok).toBe(false);
    expect(t.error).toMatch(/delivered order/);
  });

  it("rejects a verdict after the verification deadline", () => {
    const t = transition(delivered(), goodCert("PASS", T0 + 7100), T0 + 7300);
    expect(t.ok).toBe(false);
    expect(t.error).toMatch(/verification window closed/i);
  });
});

describe("deadline finalisation", () => {
  it("refunds and slashes an accepted order that was never delivered", () => {
    const state = accepted();
    const t = transition(state, {type: "finalizeUndelivered"}, T0 + 3601);
    expect(t.status).toBe("Slashed");
    expect(t.buyerDelta).toBe(PRICE + MAX_SLASH);
    expect(t.slashed).toBe(MAX_SLASH);
    expect(conserves(state, t)).toBe(true);
  });

  it("refunds only when nobody ever accepted", () => {
    const state = funded();
    const t = transition(state, {type: "finalizeUndelivered"}, T0 + 3601);
    expect(t.status).toBe("Refunded");
    expect(t.buyerDelta).toBe(PRICE);
    expect(t.slashed).toBe(0n);
  });

  it("will not finalise before the deadline", () => {
    const t = transition(accepted(), {type: "finalizeUndelivered"}, T0 + 100);
    expect(t.ok).toBe(false);
  });

  it("verifier timeout refunds the buyer without punishing the operator", () => {
    const state = delivered();
    const t = transition(state, {type: "finalizeVerifierTimeout"}, T0 + 7300);
    expect(t.status).toBe("Refunded");
    expect(t.buyerDelta).toBe(PRICE);
    expect(t.slashed).toBe(0n);
    expect(t.unlocked).toBe(MAX_SLASH);
    expect(conserves(state, t)).toBe(true);
  });

  it("will not time out the verifier while the window is open", () => {
    const t = transition(delivered(), {type: "finalizeVerifierTimeout"}, T0 + 100);
    expect(t.ok).toBe(false);
  });
});

describe("cancel", () => {
  it("lets the buyer pull an unaccepted order", () => {
    const t = transition(funded(), {type: "cancel", caller: "buyer"}, T0 + 10);
    expect(t.status).toBe("Cancelled");
    expect(t.buyerDelta).toBe(PRICE);
  });

  it("blocks anyone else", () => {
    const t = transition(funded(), {type: "cancel", caller: "other"}, T0 + 10);
    expect(t.ok).toBe(false);
  });

  it("blocks cancellation once an operator has committed", () => {
    const t = transition(accepted(), {type: "cancel", caller: "buyer"}, T0 + 10);
    expect(t.ok).toBe(false);
  });
});

describe("terminal states", () => {
  const terminals: OrderState["status"][] = ["Paid", "Refunded", "Slashed", "Cancelled"];
  const actions: Action[] = [
    {type: "cancel", caller: "buyer"},
    {type: "accept", availableStake: MAX_SLASH, registered: true},
    {type: "deliver", caller: "operator", outputHash: "0xabc"},
    goodCert("PASS"),
    {type: "finalizeUndelivered"},
    {type: "finalizeVerifierTimeout"},
  ];

  for (const status of terminals) {
    for (const action of actions) {
      it(`${status} rejects ${action.type}`, () => {
        const state = funded({status, lockedStake: 0n});
        const t = transition(state, action, T0 + 10_000);
        expect(isTerminal(state.status)).toBe(true);
        expect(t.ok).toBe(false);
        expect(t.status).toBe(status);
        expect(conserves(state, t)).toBe(true);
      });
    }
  }

  it("never pays and refunds in the same transition", () => {
    for (const state of [delivered(), accepted(), funded()]) {
      for (const action of actions) {
        const t = transition(state, action, T0 + 120);
        expect(t.buyerDelta === 0n || t.operatorDelta === 0n).toBe(true);
      }
    }
  });
});

describe("full lifecycles", () => {
  it("runs the PAY path end to end", () => {
    const {state, transitions} = simulate(funded(), [
      {action: {type: "accept", availableStake: 2n * MAX_SLASH, registered: true}, at: T0 + 10},
      {action: {type: "deliver", caller: "operator", outputHash: "0xdead"}, at: T0 + 60},
      {action: goodCert("PASS", T0 + 90), at: T0 + 90},
    ]);
    expect(transitions.every((t) => t.ok)).toBe(true);
    expect(state.status).toBe("Paid");
    expect(state.lockedStake).toBe(0n);
  });

  it("runs the SLASH path end to end", () => {
    const {state, transitions} = simulate(funded(), [
      {action: {type: "accept", availableStake: 2n * MAX_SLASH, registered: true}, at: T0 + 10},
      {action: {type: "deliver", caller: "operator", outputHash: "0xdead"}, at: T0 + 60},
      {action: goodCert("FAIL", T0 + 90), at: T0 + 90},
    ]);
    expect(transitions.every((t) => t.ok)).toBe(true);
    expect(state.status).toBe("Slashed");
    expect(state.lockedStake).toBe(0n);
    expect(transitions.at(-1)!.buyerDelta).toBe(PRICE + MAX_SLASH);
  });

  it("slashing never exceeds the stake locked for the order", () => {
    for (const locked of [0n, 1n, MAX_SLASH / 2n, MAX_SLASH, MAX_SLASH * 3n]) {
      const state = delivered({lockedStake: locked});
      const t = transition(state, goodCert("FAIL"), T0 + 120);
      expect(t.slashed <= locked).toBe(true);
      expect(t.slashed <= state.maxSlash).toBe(true);
      expect(t.slashed + t.unlocked).toBe(locked);
      expect(conserves(state, t)).toBe(true);
    }
  });
});
