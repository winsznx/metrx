import {useCallback, useEffect, useRef, useState} from "react";
import {useAccount, usePublicClient, useSwitchChain, useWriteContract} from "wagmi";
import {waitForTransactionReceipt} from "wagmi/actions";
import type {Abi, Address, Hex, PublicClient} from "viem";
import {
  ZERO_ADDRESS,
  decodeOperator,
  decodeOrder,
  metrxCoreAbi,
  type OperatorProfile,
  type Order,
} from "@metrx/shared";
import {CHAIN_ID, CORE_ADDRESS} from "./config";
import {wagmiConfig} from "./wagmi";
import {humanError, type FriendlyError} from "./errors";
import {useWalletChainId} from "./wallet";

export const coreAbi = metrxCoreAbi as unknown as Abi;

export const coreContract = () => {
  if (!CORE_ADDRESS) throw new Error("MetrxCore is not deployed yet.");
  return {address: CORE_ADDRESS, abi: coreAbi} as const;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type Loadable<T> = {data: T | null; loading: boolean; error: FriendlyError | null; reload: () => void};

/**
 * Runs one contract read and tracks its lifecycle.
 *
 * `key` is the identity of the read — change it and the read re-runs. The reader closure
 * is deliberately held in a ref rather than declared as a dependency: it is rebuilt on
 * every render, so depending on it would re-fetch on every render, and `key` already
 * describes everything the read depends on.
 */
function useChainRead<T>(key: string, read: (client: PublicClient) => Promise<T>, pollMs = 0): Loadable<T> {
  const client = usePublicClient();
  const readRef = useRef(read);
  readRef.current = read;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!client || !CORE_ADDRESS) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    readRef
      .current(client as PublicClient)
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(humanError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, key, nonce]);

  useEffect(() => {
    if (!pollMs) return;
    const t = setInterval(() => setNonce((n) => n + 1), pollMs);
    return () => clearInterval(t);
  }, [pollMs]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return {data, loading, error, reload};
}

export function useOrder(orderId: bigint | null, pollMs = 15_000): Loadable<Order> {
  return useChainRead(`order:${orderId ?? ""}`, async (client) => {
    if (orderId === null) throw new Error("UnknownOrder");
    const raw = await client.readContract({...coreContract(), functionName: "getOrder", args: [orderId]});
    return decodeOrder(orderId, raw as never);
  }, pollMs);
}

/** Reads run in bounded waves: BOT Chain has no Multicall3, and unbounded parallel eth_calls
 *  get throttled by the public RPC. */
const READ_CONCURRENCY = 8;

async function inWaves<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += READ_CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + READ_CONCURRENCY).map(fn))));
  }
  return out;
}

export function useOrders(limit = 50): Loadable<Order[]> & {total: bigint} {
  const [total, setTotal] = useState(0n);
  const read = useChainRead(`orders:${limit}`, async (client) => {
    const count = (await client.readContract({...coreContract(), functionName: "totalOrders"})) as bigint;
    setTotal(count);
    const total = count;
    if (total === 0n) return [];
    const start = total > BigInt(limit) ? total - BigInt(limit) + 1n : 1n;
    const ids: bigint[] = [];
    for (let i = total; i >= start; i--) ids.push(i);

    const raw = await inWaves(ids, (id) =>
      client
        .readContract({...coreContract(), functionName: "getOrder", args: [id]})
        .then((r) => decodeOrder(id, r as never))
        .catch(() => null)
    );
    return raw.filter((o): o is Order => o !== null);
  }, 20_000);

  return {...read, total};
}

export function useOperator(address: Address | undefined): Loadable<OperatorProfile> {
  return useChainRead(`operator:${address ?? ""}`, async (client) => {
    if (!address) throw new Error("NotRegistered");
    const raw = await client.readContract({...coreContract(), functionName: "getOperator", args: [address]});
    return decodeOperator(raw as never);
  });
}

export const isRegistered = (op: OperatorProfile | null) => !!op && op.owner !== ZERO_ADDRESS;

// ---------------------------------------------------------------------------
// Network gate
// ---------------------------------------------------------------------------

export function useNetworkGate() {
  const {isConnected} = useAccount();
  const walletChainId = useWalletChainId();
  const {switchChain, isPending} = useSwitchChain();
  // wagmi reports the configured chain, not the wallet's, so the real chain comes from the provider.
  const wrongNetwork = isConnected && walletChainId !== null && walletChainId !== CHAIN_ID;
  const switchToBot = useCallback(() => switchChain({chainId: CHAIN_ID}), [switchChain]);
  return {wrongNetwork, switching: isPending, switchToBot, chainId: walletChainId ?? CHAIN_ID};
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type TxPhase = "idle" | "awaiting-signature" | "pending" | "confirmed" | "failed";

export interface TxState {
  phase: TxPhase;
  hash: Hex | null;
  error: FriendlyError | null;
}

const IDLE: TxState = {phase: "idle", hash: null, error: null};

/**
 * One write path for every on-chain action in the product.
 *
 * BOT Chain reports a zero base fee, so every transaction is sent as legacy (type 0)
 * rather than letting the wallet guess at EIP-1559 fields the chain does not use.
 */
export function useMetrxWrite() {
  const {writeContractAsync} = useWriteContract();
  const [state, setState] = useState<TxState>(IDLE);

  const send = useCallback(
    async (functionName: string, args: readonly unknown[], value?: bigint): Promise<Hex | null> => {
      setState({phase: "awaiting-signature", hash: null, error: null});
      try {
        const hash = await writeContractAsync({
          ...coreContract(),
          functionName,
          args,
          value,
          chainId: CHAIN_ID,
          type: "legacy",
        } as never);
        setState({phase: "pending", hash, error: null});
        const receipt = await waitForTransactionReceipt(wagmiConfig, {hash, chainId: CHAIN_ID, confirmations: 1});
        if (receipt.status === "reverted") {
          setState({
            phase: "failed",
            hash,
            error: {
              title: "Transaction reverted",
              detail: "The chain accepted the transaction but the contract rejected the action. Nothing changed.",
              benign: false,
            },
          });
          return null;
        }
        setState({phase: "confirmed", hash, error: null});
        return hash;
      } catch (e) {
        setState({phase: "failed", hash: null, error: humanError(e)});
        return null;
      }
    },
    [writeContractAsync]
  );

  const reset = useCallback(() => setState(IDLE), []);
  const busy = state.phase === "awaiting-signature" || state.phase === "pending";
  return {send, reset, busy, ...state};
}

/** Live wall-clock seconds, so deadline countdowns stay honest without a page refresh. */
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * Live BOT balance.
 *
 * Read once, a zero balance permanently disabled the Fund button: topping up the wallet in
 * another tab could never unstick it. This re-reads on an interval and on window focus, which
 * is exactly when someone comes back from acquiring BOT.
 */
export function useBotBalance(intervalMs = 12_000) {
  const {address} = useAccount();
  const client = usePublicClient();
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    if (!address || !client) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    const read = () =>
      client
        .getBalance({address})
        .then((b) => !cancelled && setBalance(b))
        .catch(() => undefined);

    read();
    const timer = setInterval(read, intervalMs);
    window.addEventListener("focus", read);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, [address, client, intervalMs]);

  return balance;
}

/**
 * BOT credited after a direct payout call failed.
 *
 * `_payout` forwards a bounded gas stipend and falls back to a pull credit, so a contract
 * wallet or an expensive receive hook lands here instead of stranding the escrow. Without a
 * surface for it, that money was reachable only by calling the contract by hand.
 */
export function useWithdrawable(): {amount: bigint; reload: () => void} {
  const {address} = useAccount();
  const read = useChainRead(
    `withdrawable:${address ?? ""}`,
    async (client) => {
      if (!address) return 0n;
      return (await client.readContract({
        ...coreContract(),
        functionName: "withdrawable",
        args: [address],
      })) as bigint;
    },
    30_000
  );
  return {amount: read.data ?? 0n, reload: read.reload};
}
