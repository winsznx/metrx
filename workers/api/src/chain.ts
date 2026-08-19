import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  http,
  keccak256,
  numberToHex,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
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
      batch: {batchSize: 20, wait: 8},
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

export async function readOrders(env: Env, limit: number, offset = 0): Promise<Order[]> {
  const total = await readTotalOrders(env);
  if (total === 0n) return [];
  const newest = total - BigInt(offset);
  if (newest < 1n) return [];
  const start = newest > BigInt(limit) ? newest - BigInt(limit) + 1n : 1n;
  const ids: bigint[] = [];
  for (let i = start; i <= newest; i++) ids.push(i);
  return readOrdersByIds(env, ids).then((list) => list.reverse());
}

/** Batched read of specific ids, used by the per-address index. */
export async function readOrdersByIds(env: Env, ids: bigint[]): Promise<Order[]> {
  const results = await Promise.all(ids.map((id) => readOrder(env, id).catch(() => null)));
  return results.filter((o): o is Order => o !== null);
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
  const fromBlock = await safeFromBlock(env, client);

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

// ---------------------------------------------------------------------------
// Log-derived indexes
// ---------------------------------------------------------------------------

const addressTopic = (address: Address) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}` as Hex;

async function safeFromBlock(env: Env, client: PublicClient): Promise<bigint> {
  const configured = BigInt(env.METRX_DEPLOY_BLOCK || DEPLOYMENT.deployedAtBlock || 0);
  if (configured === 0n) return 0n;
  const head = await client.getBlockNumber().catch(() => 0n);
  return configured > head ? 0n : configured;
}

async function logsFor(env: Env, topics: (Hex | null)[]): Promise<RawLog[]> {
  const client = publicClient(env);
  const fromBlock = await safeFromBlock(env, client);
  return (await client
    .request({
      method: "eth_getLogs",
      params: [{address: coreAddress(env), fromBlock: numberToHex(fromBlock), toBlock: "latest", topics}],
    })
    .catch(() => [])) as RawLog[];
}

const ORDER_CREATED = "OrderCreated";
const ORDER_ACCEPTED = "OrderAccepted";
const OPERATOR_REGISTERED = "OperatorRegistered";

const topicOf = (name: string): Hex => {
  const item = (metrxCoreAbi as readonly {type: string; name?: string}[]).find(
    (i) => i.type === "event" && i.name === name
  );
  return keccak256(toHex(eventSignature(item as never)));
};

/** Solidity event signature, e.g. OrderCreated(uint256,address,uint256). */
function eventSignature(item: {name: string; inputs: {type: string}[]}): string {
  return `${item.name}(${item.inputs.map((i) => i.type).join(",")})`;
}

/**
 * Order ids an address touched, as buyer or as operator.
 *
 * `OrderCreated` indexes the buyer and `OrderAccepted` indexes the operator, so an address
 * index needs no contract change and no database. Scanning the tail of all orders, which is
 * what the app did before, silently hid a user's own orders once the contract got busy.
 */
export async function readOrderIdsForAddress(env: Env, address: Address): Promise<bigint[]> {
  const topic = addressTopic(address);
  const [created, accepted] = await Promise.all([
    logsFor(env, [topicOf(ORDER_CREATED), null, topic]),
    logsFor(env, [topicOf(ORDER_ACCEPTED), null, topic]),
  ]);
  const ids = new Set<string>();
  for (const log of [...created, ...accepted]) {
    if (log.topics[1]) ids.add(BigInt(log.topics[1]).toString());
  }
  return [...ids].map(BigInt).sort((a, b) => (a > b ? -1 : 1));
}

export interface OperatorSummary {
  address: Address;
  stake: string;
  lockedStake: string;
  available: string;
  slashed: string;
  active: boolean;
  metadataURI: string;
}

/**
 * The supply side, so a buyer can see before funding whether anyone can actually take the job.
 * Without this a buyer could escrow real BOT against a max slash no operator could cover.
 */
export async function readOperators(env: Env): Promise<OperatorSummary[]> {
  const logs = await logsFor(env, [topicOf(OPERATOR_REGISTERED)]);
  const addresses = [...new Set(logs.map((l) => `0x${l.topics[1]!.slice(26)}`.toLowerCase()))] as Address[];
  const profiles = await Promise.all(addresses.map((a) => readOperator(env, a).catch(() => null)));

  return addresses
    .map((address, i) => {
      const p = profiles[i];
      if (!p) return null;
      return {
        address,
        stake: p.stake.toString(),
        lockedStake: p.lockedStake.toString(),
        available: (p.stake - p.lockedStake).toString(),
        slashed: p.slashed.toString(),
        active: p.active,
        metadataURI: p.metadataURI,
      };
    })
    .filter((o): o is OperatorSummary => o !== null);
}

/**
 * Rebuilds the signed certificate from the settlement transaction itself.
 *
 * A cache only holds certificates this service happened to sign. Anyone can submit a valid
 * certificate, and the calldata carries every field, so deriving it from chain means the proof
 * page shows the real signature for every settled order regardless of who settled it or when.
 */
export async function readSettlementCertificate(
  env: Env,
  txHash: Hex,
  order: Order
): Promise<{
  signature: Hex;
  digest: Hex;
  verifierAddress: Address;
  evaluatedAt: number;
  typedData: Record<string, unknown>;
  source: "settlement-transaction";
} | null> {
  const client = publicClient(env);
  const tx = await client.getTransaction({hash: txHash}).catch(() => null);
  if (!tx?.input) return null;

  let args: readonly unknown[] | undefined;
  try {
    const decoded = decodeFunctionData({abi: metrxCoreAbi, data: tx.input});
    if (decoded.functionName !== "settleWithAIVerdict") return null;
    args = decoded.args as readonly unknown[];
  } catch {
    return null;
  }
  if (!args || args.length < 6) return null;

  const [, verdict, scoreBps, reasonHash, evaluatedAt, signature] = args as [
    bigint,
    number,
    number,
    Hex,
    bigint,
    Hex,
  ];

  const [aiVerifier, digest] = await Promise.all([
    readAiVerifier(env),
    client.readContract({
      address: coreAddress(env),
      abi: metrxCoreAbi,
      functionName: "aiVerdictDigest",
      args: [order.id, verdict, scoreBps, reasonHash, evaluatedAt],
    }) as Promise<Hex>,
  ]);

  return {
    signature,
    digest,
    verifierAddress: aiVerifier,
    evaluatedAt: Number(evaluatedAt),
    typedData: {
      domain: {name: "Metrx", version: "1", chainId: Number(env.BOT_CHAIN_ID || 677), verifyingContract: coreAddress(env)},
      primaryType: "AIVerdict",
      message: {
        orderId: order.id.toString(),
        jobSpecHash: order.jobSpecHash,
        inputHash: order.inputHash,
        rubricHash: order.rubricHash,
        modelHash: order.modelHash,
        outputHash: order.outputHash,
        verdict: Number(verdict),
        scoreBps: Number(scoreBps),
        reasonHash,
        evaluatedAt: evaluatedAt.toString(),
      },
    },
    source: "settlement-transaction",
  };
}
