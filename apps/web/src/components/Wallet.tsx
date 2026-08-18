import {useAccount, useConnect, useDisconnect} from "wagmi";
import {useState} from "react";
import {CHAIN_ID} from "@/lib/config";
import {useBotBalance, useNetworkGate} from "@/lib/contract";
import {botAmount, shortAddress} from "@/lib/format";
import {humanError, type FriendlyError} from "@/lib/errors";
import {Notice} from "./primitives";

export function ConnectButton({size = "md"}: {size?: "sm" | "md"}) {
  const {address, isConnected} = useAccount();
  const {connectors, connectAsync, isPending} = useConnect();
  const {disconnect} = useDisconnect();
  const [error, setError] = useState<FriendlyError | null>(null);

  const injected = connectors[0];
  const hasWallet = typeof window !== "undefined" && !!window.ethereum;

  const connect = async () => {
    setError(null);
    if (!injected) return;
    try {
      await connectAsync({connector: injected, chainId: CHAIN_ID});
    } catch (e) {
      setError(humanError(e));
    }
  };

  if (isConnected && address) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        className={`btn btn-ghost ${size === "sm" ? "text-[13px] py-1.5 px-3" : ""}`}
        title="Disconnect"
      >
        <span className="mono">{shortAddress(address)}</span>
      </button>
    );
  }

  if (!hasWallet) {
    return (
      <a className="btn btn-ghost" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
        Install a wallet
      </a>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button type="button" onClick={connect} disabled={isPending} className="btn btn-primary">
        {isPending ? "Check your wallet…" : "Connect wallet"}
      </button>
      {error && <span className="max-w-xs text-right text-xs text-clay">{error.detail}</span>}
    </div>
  );
}

/** Rendered above every write surface so a wrong-network wallet can never silently fail. */
export function NetworkBanner() {
  const {wrongNetwork, switching, switchToBot} = useNetworkGate();
  const [manual, setManual] = useState(false);
  if (!wrongNetwork) return null;

  return (
    <Notice
      tone="warn"
      title="Wrong network"
      action={
        <button type="button" className="btn btn-primary" onClick={switchToBot} disabled={switching}>
          {switching ? "Switching…" : "Switch to BOT Chain"}
        </button>
      }
    >
      <p>Metrx settles on BOT Chain Mainnet. Switch networks to create, accept, deliver, or settle jobs.</p>
      <button type="button" className="mt-1 text-xs underline underline-offset-2" onClick={() => setManual((m) => !m)}>
        {manual ? "Hide manual config" : "Show manual config"}
      </button>
      {manual && (
        <dl className="mono mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-stone">Network</dt>
          <dd>BOT Chain Mainnet</dd>
          <dt className="text-stone">Chain ID</dt>
          <dd>677</dd>
          <dt className="text-stone">RPC</dt>
          <dd>https://rpc.botchain.ai</dd>
          <dt className="text-stone">Currency</dt>
          <dd>BOT (18 decimals)</dd>
          <dt className="text-stone">Explorer</dt>
          <dd>https://scan.botchain.ai</dd>
        </dl>
      )}
    </Notice>
  );
}

export function WalletSummary() {
  const {address, isConnected} = useAccount();
  const balance = useBotBalance();
  if (!isConnected || !address) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
      <span className="text-stone">
        Wallet <span className="mono text-ink">{shortAddress(address)}</span>
      </span>
      <span className="text-stone">
        Balance <span className="text-ink">{botAmount(balance)}</span>
      </span>
      <span className="pill border border-ink/15 text-slate">BOT Mainnet · 677</span>
    </div>
  );
}
