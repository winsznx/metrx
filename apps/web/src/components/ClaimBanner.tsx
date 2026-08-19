import {useMetrxWrite, useNetworkGate, useWithdrawable} from "@/lib/contract";
import {botAmount} from "@/lib/format";
import {ErrorNotice, Notice, TxLink} from "./primitives";

/** Shown wherever money matters, so a deferred payout is never silently unreachable. */
export function ClaimBanner() {
  const {amount, reload} = useWithdrawable();
  const {wrongNetwork} = useNetworkGate();
  const tx = useMetrxWrite();

  if (amount === 0n) return null;

  return (
    <Notice
      tone="good"
      title={`You have ${botAmount(amount)} to claim`}
      action={
        <button
          type="button"
          className="btn btn-primary"
          disabled={tx.busy || wrongNetwork}
          onClick={async () => {
            const hash = await tx.send("withdraw", []);
            if (hash) reload();
          }}
        >
          {tx.busy ? "Working…" : "Claim your BOT"}
        </button>
      }
    >
      <p>
        A settlement payout could not be delivered to your wallet directly, so the contract is holding it for you. It is
        yours whenever you want it.
      </p>
      {tx.phase === "pending" && tx.hash && (
        <p className="mt-1">
          Waiting for confirmation · <TxLink hash={tx.hash} />
        </p>
      )}
      <div className="mt-2">
        <ErrorNotice error={tx.error} />
      </div>
    </Notice>
  );
}
