import {useAccount, useConnect, useDisconnect} from "wagmi";
import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {CHAIN_ID} from "@/lib/config";
import {useBotBalance, useNetworkGate} from "@/lib/contract";
import {isMobileBrowser, useHasWallet} from "@/lib/wallet";
import {botAmount, shortAddress} from "@/lib/format";
import {humanError, type FriendlyError} from "@/lib/errors";
import {explorerAddress} from "@metrx/shared";
import {Notice} from "./primitives";

export function ConnectButton({size = "md"}: {size?: "sm" | "md"}) {
  const {address, isConnected, status} = useAccount();
  const {connectors, connectAsync, isPending} = useConnect();
  const [error, setError] = useState<FriendlyError | null>(null);
  const [picking, setPicking] = useState(false);
  const hasWallet = useHasWallet();

  // Dismiss the picker on Escape, matching the backdrop click-to-close.
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicking(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  // EIP-6963 makes every installed wallet its own connector. Picking connectors[0] blindly
  // meant a user with two wallets always got whichever one won the injection race.
  const wallets = connectors.filter((c) => c.type === "injected" || c.id !== "injected");
  const unique = wallets.filter((c, i) => wallets.findIndex((o) => o.name === c.name) === i);

  const connect = async (connector: (typeof connectors)[number]) => {
    setError(null);
    setPicking(false);
    try {
      await connectAsync({connector, chainId: CHAIN_ID});
    } catch (e) {
      setError(humanError(e));
    }
  };

  if (status === "reconnecting" || status === "connecting") {
    return <span className="btn btn-ghost opacity-60">Reconnecting…</span>;
  }

  if (isConnected && address) return <AccountMenu address={address} size={size} />;

  if (!hasWallet && unique.length === 0) {
    return isMobileBrowser() ? (
      <div className="max-w-xs text-right">
        <a className="btn btn-ghost" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
          Open in a wallet browser
        </a>
        <p className="mt-1 text-xs text-stone">
          Mobile browsers cannot inject a wallet. Open metrx.pages.dev inside your wallet app's browser, or use a
          desktop browser. Reading the proof hub needs no wallet.
        </p>
      </div>
    ) : (
      <div className="max-w-xs text-right">
        <a className="btn btn-ghost" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
          Install a wallet
        </a>
        <p className="mt-1 text-xs text-stone">Install the extension, then come back to this tab. It detects it on its own.</p>
      </div>
    );
  }

  if (picking && unique.length > 1) {
    return (
      <div className="flex flex-col items-end gap-2">
        <button type="button" disabled className="btn btn-primary opacity-60">
          Connect wallet
        </button>
        {createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Choose a wallet"
            onClick={() => setPicking(false)}
          >
            <div className="card w-full max-w-sm p-5 text-left" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-medium text-ink">Connect a wallet</h2>
                <button type="button" className="text-sm text-stone hover:text-ink" onClick={() => setPicking(false)}>
                  Close
                </button>
              </div>
              <p className="mt-1 text-sm text-stone">
                Metrx uses your browser wallet on BOT Chain Mainnet. Nothing is stored on our side.
              </p>
              <div className="mt-4 flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
                {unique.map((c) => (
                  <button
                    key={c.uid}
                    type="button"
                    className="flex w-full items-center justify-between rounded-xl border border-ink/15 px-4 py-3 text-sm font-medium hover:border-ink/30 hover:bg-mist/40"
                    onClick={() => connect(c)}
                  >
                    <span>{c.name}</span>
                    <span aria-hidden className="text-stone">
                      →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => (unique.length > 1 ? setPicking(true) : connect(unique[0]!))}
        disabled={isPending || unique.length === 0}
        className="btn btn-primary"
        aria-haspopup="dialog"
      >
        {isPending ? "Check your wallet…" : "Connect wallet"}
      </button>
      {error && <span className="max-w-xs text-right text-xs text-clay">{error.detail}</span>}
    </div>
  );
}

/** The address chip used to disconnect on a single click, with no label and no confirmation. */
function AccountMenu({address, size}: {address: string; size: "sm" | "md"}) {
  const {disconnect} = useDisconnect();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`btn btn-ghost ${size === "sm" ? "px-3 py-1.5 text-[13px]" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Wallet menu"
      >
        <span className="mono">{shortAddress(address)}</span>
      </button>
      {open && (
        <div className="card absolute right-0 z-40 mt-2 w-56 p-2" role="menu">
          <button
            type="button"
            role="menuitem"
            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-mist/50"
            onClick={async () => {
              await navigator.clipboard.writeText(address).catch(() => undefined);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
          >
            {copied ? "Copied" : "Copy address"}
          </button>
          <a
            role="menuitem"
            className="block rounded-lg px-3 py-2 text-sm hover:bg-mist/50"
            href={explorerAddress(address)}
            target="_blank"
            rel="noreferrer"
          >
            View on BOTScan
          </a>
          <a role="menuitem" className="block rounded-lg px-3 py-2 text-sm hover:bg-mist/50" href="/app/settings">
            Settings
          </a>
          <button
            type="button"
            role="menuitem"
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-clay hover:bg-clay/10"
            onClick={() => {
              setOpen(false);
              disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

/** Rendered above every write surface so a wrong-network wallet can never silently fail. */
export function NetworkBanner() {
  const {wrongNetwork, switching, switchToBot, chainId} = useNetworkGate();
  const [manual, setManual] = useState(false);
  if (!wrongNetwork) return null;

  return (
    <Notice
      tone="warn"
      title={`Wrong network — your wallet is on chain ${chainId}`}
      action={
        <button type="button" className="btn btn-primary" onClick={switchToBot} disabled={switching}>
          {switching ? "Switching…" : "Switch to BOT Chain"}
        </button>
      }
    >
      <p>Metrx settles on BOT Chain Mainnet. Switch networks to create, accept, deliver, or settle jobs.</p>
      <button type="button" className="mt-1 text-xs underline underline-offset-2" onClick={() => setManual((m) => !m)}>
        {manual ? "Hide manual config" : "Add the network manually"}
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

/**
 * Warns when the wallet switches account mid-flow.
 * Without this a half-filled order silently funds from a different wallet than it started in.
 */
export function AccountChangeBanner() {
  const {address} = useAccount();
  const previous = useRef<string | null>(null);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (!address) return;
    if (previous.current && previous.current !== address) setChanged(true);
    previous.current = address;
  }, [address]);

  if (!changed || !address) return null;
  return (
    <Notice
      tone="warn"
      title="Your wallet changed"
      action={
        <button type="button" className="btn btn-ghost" onClick={() => setChanged(false)}>
          Got it
        </button>
      }
    >
      Now acting as <span className="mono">{shortAddress(address)}</span>. Review this page before continuing — any
      transaction you send now comes from the new account.
    </Notice>
  );
}

export function WalletSummary() {
  const {address, isConnected} = useAccount();
  const balance = useBotBalance();
  const {wrongNetwork, chainId} = useNetworkGate();
  if (!isConnected || !address) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
      <span className="text-stone">
        Wallet <span className="mono text-ink">{shortAddress(address)}</span>
      </span>
      <span className="text-stone">
        Balance <span className="text-ink">{botAmount(balance)}</span>
      </span>
      <span className={`pill border ${wrongNetwork ? "border-clay/40 text-clay" : "border-ink/15 text-slate"}`}>
        {wrongNetwork ? `Chain ${chainId} · not BOT` : "BOT Mainnet · 677"}
      </span>
    </div>
  );
}
