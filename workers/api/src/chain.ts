import {createPublicClient, decodeEventLog, http, numberToHex, type Address, type Hex, type PublicClient} from "viem";
import {
  DEPLOYMENT,
  botChain,
  decodeOperator,
  decodeOrder,
  explorerTx,
  metrxCoreAbi,
  type OperatorProfile,
  type Order,
} from "@metrx/shared";
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

// ---------------------------------------------------------------------------
// On-chain timeline
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  event: string;
  label: string;
  txHash: Hex;
  blockNumber: string;
  timestamp: number | null;
  explorer: string;
}

interface RawLog {
  data: Hex;
  topics: [Hex, ...Hex[]];
  transactionHash: Hex;
  blockNumber: Hex;
}

/** Every order-scoped event carries `orderId` as its first indexed parameter. */
const orderTopic = (orderId: bigint) => numberToHex(orderId, {size: 32});

const EVENT_LABELS: Record<string, string> = {
  OrderCreated: "Order funded",
  OrderAccepted: "Operator accepted",
  DeliverySubmitted: "Output delivered",
  AIVerdictSettled: "AI verdict signed",
  OrderPaid: "Operator paid",
  OrderRefunded: "Buyer refunded",
  OperatorSlashed: "Operator slashed",
  OrderCancelled: "Order cancelled",
};

/**
 * Rebuilds an order's transaction trail from event logs.
 *
 * A transaction cannot record its own hash, so the contract does not store one. Logs are the
 * only way to get from an order back to the transactions that moved it, which is what makes
 * a proof page independently checkable on the explorer.
 */
export async function readOrderTimeline(env: Env, orderId: bigint): Promise<TimelineEntry[]> {
  const client = publicClient(env);
  const fromBlock = BigInt(env.METRX_DEPLOY_BLOCK || DEPLOYMENT.deployedAtBlock || 0);

  // viem's typed getLogs cannot express "any event with this orderId topic" across a
  // heterogeneous event set, so the filter goes out as a raw JSON-RPC call.
  const logs = (await client
    .request({
      method: "eth_getLogs",
      params: [
        {
          address: coreAddress(env),
          fromBlock: numberToHex(fromBlock),
          toBlock: "latest",
          topics: [null, orderTopic(orderId)],
        },
      ],
    })
    .catch(() => [])) as RawLog[];

  const blocks = new Map<string, number | null>();
  await Promise.all(
    [...new Set(logs.map((l) => BigInt(l.blockNumber).toString()))].map(async (n) => {
      const block = await client.getBlock({blockNumber: BigInt(n)}).catch(() => null);
      blocks.set(n, block ? Number(block.timestamp) : null);
    })
  );

  const entries: TimelineEntry[] = [];
  for (const log of logs) {
    let name: string;
    try {
      name = decodeEventLog({abi: metrxCoreAbi, data: log.data, topics: log.topics}).eventName;
    } catch {
      continue;
    }
    const label = EVENT_LABELS[name];
    if (!label) continue;
    const blockNumber = BigInt(log.blockNumber).toString();
    entries.push({
      event: name,
      label,
      txHash: log.transactionHash,
      blockNumber,
      timestamp: blocks.get(blockNumber) ?? null,
      explorer: explorerTx(log.transactionHash),
    });
  }
  return entries;
}
