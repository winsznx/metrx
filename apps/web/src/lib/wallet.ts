import {useCallback, useEffect, useState, useSyncExternalStore} from "react";
import {useAccount} from "wagmi";

/**
 * Wallet facts wagmi cannot tell us.
 *
 * wagmi only tracks chains listed in its config, and Metrx configures BOT Chain alone. That
 * makes `useChainId()` report 677 no matter what the wallet is actually on, which silently
 * disabled every wrong-network guard. These hooks read the injected provider directly.
 */

type Provider = {
  request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

const injected = (): Provider | undefined => (globalThis as {ethereum?: Provider}).ethereum;

/**
 * The chain the *connected* wallet is really on, or null when disconnected.
 *
 * Reading `window.ethereum` was wrong with more than one wallet installed: EIP-6963 lets several
 * extensions inject, and whichever won the `window.ethereum` race could be a different wallet, on a
 * different chain, than the one wagmi actually connected — so the banner reported that stray wallet's
 * chain (e.g. Ethereum 1) while the connected wallet sat on BOT Chain. Read from the connected
 * connector's own provider, and listen for `chainChanged` on that same provider.
 */
export function useWalletChainId(): number | null {
  const {connector, isConnected} = useAccount();
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    if (!isConnected || !connector?.getProvider) {
      setChainId(null);
      return;
    }
    let cancelled = false;
    let provider: Provider | undefined;
    const onChainChanged = (hex: unknown) => setChainId(Number(hex));

    connector
      .getProvider()
      .then((p) => {
        if (cancelled) return undefined;
        provider = p as Provider;
        provider.on?.("chainChanged", onChainChanged);
        return provider.request({method: "eth_chainId"});
      })
      .then((hex) => {
        if (!cancelled && hex !== undefined) setChainId(Number(hex));
      })
      .catch(() => !cancelled && setChainId(null));

    return () => {
      cancelled = true;
      provider?.removeListener?.("chainChanged", onChainChanged);
    };
  }, [connector, isConnected]);

  return chainId;
}

/**
 * Whether an injected wallet is present, kept live.
 *
 * Reading `window.ethereum` once at render trapped users who installed a wallet and came back
 * to the tab: the button said "Install a wallet" forever. Extensions announce themselves late
 * via EIP-6963 and `ethereum#initialized`, so this re-checks on both plus window focus.
 */
export function useHasWallet(): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const events = ["eip6963:announceProvider", "ethereum#initialized", "focus", "visibilitychange"];
    events.forEach((e) => window.addEventListener(e, notify));
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const poll = setInterval(notify, 1500);
    return () => {
      events.forEach((e) => window.removeEventListener(e, notify));
      clearInterval(poll);
    };
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => injected() !== undefined,
    () => false
  );
}

/** Mobile browsers expose no injected provider, so the desktop "install an extension" advice is wrong there. */
export const isMobileBrowser = () =>
  typeof navigator !== "undefined" && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);

export const BOT_BRIDGE_URL = "https://bridge.botchain.ai";
export const BOT_CHAIN_SITE = "https://botchain.ai";
