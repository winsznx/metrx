import {useCallback, useEffect, useState, useSyncExternalStore} from "react";

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

/** The chain the wallet is really on, or null when there is no wallet or it is not connected. */
export function useWalletChainId(): number | null {
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    const provider = injected();
    if (!provider) return;
    let cancelled = false;

    const read = () =>
      provider
        .request({method: "eth_chainId"})
        .then((hex) => !cancelled && setChainId(Number(hex)))
        .catch(() => !cancelled && setChainId(null));

    read();
    const onChainChanged = (hex: unknown) => setChainId(Number(hex));
    provider.on?.("chainChanged", onChainChanged);
    return () => {
      cancelled = true;
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

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
