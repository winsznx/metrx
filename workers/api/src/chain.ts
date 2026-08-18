import {createPublicClient, http, type Address, type PublicClient} from "viem";
import {botChain, metrxCoreAbi, decodeOrder, decodeOperator, type Order, type OperatorProfile} from "@metrx/shared";
import {misconfigured, notFound, type Env} from "./env.js";

/**
 * BOT Chain returns extra, non-standard fields on blocks and receipts (for example
 * `milliTimestamp`). viem's default formatters keep unknown keys, so reads work, but we
 * never assume EIP-1559 fields exist — the chain reports a zero base fee and all writes
 * are legacy transactions signed in the browser.
 */
export function publicClient(env: Env): PublicClient {
  return createPublicClient({
    chain: botChain,
    transport: http(env.BOT_RPC_URL || botChain.rpcUrls.default.http[0], {
      timeout: 20_000,
      retryCount: 2,
    }),
  }) as PublicClient;
}

export function coreAddress(env: Env): Address {
  const raw = (env.METRX_CORE_ADDRESS || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw misconfigured(
      "core_not_deployed",
      "METRX_CORE_ADDRESS is not set on this worker. Deploy MetrxCore and set the var before verifying."
    );
  }
  return raw as Address;
}

export async function readOrder(env: Env, orderId: bigint): Promise<Order> {
  const client = publicClient(env);
  const raw = await client.readContract({
    address: coreAddress(env),
    abi: metrxCoreAbi,
    functionName: "getOrder",
    args: [orderId],
  });
  const order = decodeOrder(orderId, raw as never);
  if (order.status === "None") throw notFound("unknown_order", `Order ${orderId} does not exist on chain.`);
  return order;
}

export async function readOperator(env: Env, address: Address): Promise<OperatorProfile> {
  const client = publicClient(env);
  const raw = await client.readContract({
    address: coreAddress(env),
    abi: metrxCoreAbi,
    functionName: "getOperator",
    args: [address],
  });
  return decodeOperator(raw as never);
}

/** The adjudicator address baked into the contract at deploy time. */
export async function readAiVerifier(env: Env): Promise<Address> {
  const client = publicClient(env);
  return (await client.readContract({
    address: coreAddress(env),
    abi: metrxCoreAbi,
    functionName: "aiVerifier",
  })) as Address;
}

export async function readTotalOrders(env: Env): Promise<bigint> {
  const client = publicClient(env);
  return (await client.readContract({
    address: coreAddress(env),
    abi: metrxCoreAbi,
    functionName: "totalOrders",
  })) as bigint;
}

export async function readOrders(env: Env, limit: number): Promise<Order[]> {
  const total = await readTotalOrders(env);
  if (total === 0n) return [];
  const start = total > BigInt(limit) ? total - BigInt(limit) + 1n : 1n;
  const ids: bigint[] = [];
  for (let i = start; i <= total; i++) ids.push(i);
  return Promise.all(ids.map((id) => readOrder(env, id))).then((list) => list.reverse());
}

/** JSON cannot carry bigint. Every numeric chain field is serialised as a decimal string. */
export function serialiseOrder(order: Order): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(order)) {
    out[key] = typeof value === "bigint" ? value.toString() : (value as string | number | boolean);
  }
  return out;
}
