/**
 * Maps wallet, RPC and contract failures to language a buyer or operator can act on.
 * No raw revert data or provider stack traces ever reach the UI.
 */

const CONTRACT_ERRORS: Record<string, string> = {
  ZeroAddress: "That address is not valid.",
  Reentrancy: "The contract blocked a re-entrant call. Nothing was changed.",
  AlreadyRegistered: "This wallet is already registered as an operator. Add stake instead.",
  NotRegistered: "This wallet is not registered as an operator yet.",
  StakeTooLow: "The stake is below the minimum an operator must post.",
  NothingToWithdraw: "There is nothing to withdraw.",
  InsufficientUnlockedStake: "Not enough unlocked stake. Stake locked against live orders cannot be used.",
  PriceRequired: "An order needs a price in BOT.",
  MaxSlashRequired: "Set a max slash above zero so the operator has something at risk.",
  BadDeadlines: "Deadlines are out of order. Verification must come after delivery, and both must be in the future.",
  DeadlineTooFar: "Deadlines cannot be more than 30 days out.",
  MissingJobHashes: "The job spec, rubric and model must all be committed.",
  MissingOutputHash: "A delivery needs an output.",
  UnknownOrder: "That order does not exist on chain.",
  WrongStatus: "The order moved on. Reload the page to see its current state.",
  NotBuyer: "Only the buyer who funded this order can do that.",
  NotAssignedOperator: "Only the operator who accepted this order can deliver it.",
  DeliveryWindowClosed: "The delivery window has closed for this order.",
  VerificationWindowClosed: "The verification window has closed. This order can now only be refunded.",
  VerificationWindowOpen: "The verification window is still open, so a timeout refund is not available yet.",
  DeadlineNotReached: "That deadline has not passed yet.",
  BadVerdict: "The verdict is not valid.",
  ScoreOutOfRange: "The score must be between 0 and 10000 basis points.",
  EvaluatedAtOutOfRange: "The certificate is dated outside the window the contract accepts.",
  BadSignatureLength: "The verifier signature is malformed.",
  MalleableSignature: "The verifier signature was rejected as malleable.",
  UnauthorizedVerifier: "This certificate was not signed by the AI verifier the contract trusts.",
};

const API_ERRORS: Record<string, string> = {
  core_not_deployed: "MetrxCore is not configured on the API yet.",
  verifier_key_missing: "The verifier service has no signing key configured, so it cannot sign a verdict.",
  ai_key_missing: "The verifier service has no model credentials configured.",
  ai_upstream: "The verifier model provider returned an error. Try again in a moment.",
  ai_rate_limited:
    "The verifier model is rate limited right now, so nothing was signed. Wait for the quota to reset and run it again.",
  ai_malformed: "The verifier model returned an unusable response, so nothing was signed. Run it again.",
  ai_inconsistent: "The verifier model contradicted itself, so nothing was signed. Run it again.",
  model_mismatch: "This order was created for a different verifier model than the one this service runs.",
  artifact_missing: "The published job or delivery artifact could not be found, so there is nothing to judge.",
  artifact_mismatch: "The published artifacts no longer match what was committed on chain.",
  not_delivered: "This order has no delivery to judge yet.",
  verification_closed: "The verification window has closed. This order can only be refunded now.",
  unknown_order: "That order does not exist on chain.",
  too_large: "That artifact is larger than the 64 KB limit in v1.",
};

export interface FriendlyError {
  title: string;
  detail: string;
  /** True when the user chose to stop, so the UI should stay calm rather than alarm. */
  benign: boolean;
}

export function humanError(error: unknown): FriendlyError {
  const raw = errorText(error);

  if (/user rejected|user denied|rejected the request|4001/i.test(raw)) {
    return {title: "Request cancelled", detail: "You dismissed the wallet prompt. Nothing was sent.", benign: true};
  }
  if (/insufficient funds|exceeds the balance/i.test(raw)) {
    return {
      title: "Not enough BOT",
      detail: "This wallet cannot cover the amount plus gas on BOT Chain Mainnet.",
      benign: false,
    };
  }
  if (/chain (mismatch|not configured)|does not match the target chain|unrecognized chain/i.test(raw)) {
    return {
      title: "Wrong network",
      detail: "Switch your wallet to BOT Chain Mainnet (chain 677) and try again.",
      benign: false,
    };
  }
  if (/nonce|replacement transaction underpriced|already known/i.test(raw)) {
    return {
      title: "Transaction collided",
      detail: "Another transaction from this wallet is still pending. Wait for it to confirm, then retry.",
      benign: false,
    };
  }
  if (/timeout|timed out|network request failed|failed to fetch/i.test(raw)) {
    return {
      title: "Network did not respond",
      detail: "The BOT Chain RPC or the verifier service did not answer in time. Try again.",
      benign: false,
    };
  }

  for (const [name, message] of Object.entries(CONTRACT_ERRORS)) {
    if (new RegExp(`\\b${name}\\b`).test(raw)) return {title: "Rejected by the contract", detail: message, benign: false};
  }
  for (const [code, message] of Object.entries(API_ERRORS)) {
    if (raw.includes(code)) return {title: "Verifier service", detail: message, benign: false};
  }

  if (/reverted/i.test(raw)) {
    return {
      title: "Rejected by the contract",
      detail: "The contract refused this action, most often because the order changed state. Reload and try again.",
      benign: false,
    };
  }

  return {
    title: "Something went wrong",
    detail: raw.slice(0, 220) || "No further detail was returned.",
    benign: false,
  };
}

function errorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) {
    const cause = (error as {cause?: unknown}).cause;
    const details = (error as {details?: string; shortMessage?: string}).shortMessage ?? "";
    return [error.message, details, cause ? errorText(cause) : ""].filter(Boolean).join(" | ");
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
