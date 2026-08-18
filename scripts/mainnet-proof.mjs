#!/usr/bin/env node
/**
 * Runs the two mainnet proof lifecycles the submission depends on.
 *
 *   PASS  buyer funds -> operator delivers matching output -> verifier passes -> operator paid
 *   FAIL  buyer funds -> operator delivers wrong output    -> verifier fails  -> buyer refunded, operator slashed
 *
 * Every transaction hash is recorded to PROOF_RUNS.json so the claim ledger and README
 * can cite real evidence rather than a description of what would happen.
 *
 * Usage: pnpm proof:run [pass|fail|both]
 */

import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseEther,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {loadEnv, require_, readJson, ROOT} from "./lib/env.mjs";
import {statusName} from "./lib/orderStatus.mjs";

const env = loadEnv();
const RPC = env.BOT_RPC_URL || "https://rpc.botchain.ai";
const CHAIN_ID = Number(env.BOT_CHAIN_ID || 677);
const API = (env.API_BASE_URL || env.VITE_API_BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const EXPLORER = env.BOT_EXPLORER_URL || "https://scan.botchain.ai";

const CORE = require_(env, "METRX_CORE_ADDRESS", "Deploy MetrxCore first with `pnpm contracts:deploy`.");
const buyerAccount = privateKeyToAccount(require_(env, "DEPLOYER_PRIVATE_KEY"));
const operatorAccount = privateKeyToAccount(require_(env, "DEMO_OPERATOR_PRIVATE_KEY", "Run `pnpm keys:generate`."));

const botChain = defineChain({
  id: CHAIN_ID,
  name: "BOT Chain Mainnet",
  nativeCurrency: {name: "BOT", symbol: "BOT", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
  blockExplorers: {default: {name: "BOTScan", url: EXPLORER}},
});

const abi = readJson(join(ROOT, "contracts/out/MetrxCore.sol/MetrxCore.json"))?.abi;
if (!abi) {
  console.error("No compiled ABI. Run `pnpm contracts:build` first.");
  process.exit(1);
}

const publicClient = createPublicClient({chain: botChain, transport: http(RPC, {timeout: 30_000})});
// The chain reports a zero base fee, so every write goes out as a legacy transaction.
const wallet = (account) => createWalletClient({account, chain: botChain, transport: http(RPC, {timeout: 30_000})});

const PRICE = parseEther(env.PROOF_PRICE_BOT || "0.01");
const MAX_SLASH = parseEther(env.PROOF_MAX_SLASH_BOT || "0.005");
const STAKE = parseEther(env.PROOF_STAKE_BOT || "0.02");

const RUBRIC = [
  "Output must contain exactly 3 action items",
  "Output must mention the duplicate charge refund request",
  "Output must not invent facts absent from the ticket",
];

const SPEC = {
  title: "Summarize a support ticket",
  taskType: "text-eval",
  instructions:
    "Summarize this support ticket into exactly 3 action items. Mention the refund request explicitly. Do not invent facts that are not in the ticket.",
  input:
    "Customer says their October invoice was charged twice. They already emailed support once with no reply. They are asking for a refund of the duplicate charge and want confirmation by Friday.",
  rubric: RUBRIC,
  modelId: "",
};

const GOOD_OUTPUT = `1. Confirm the duplicate charge on the customer's October invoice by checking the billing record.
2. Issue a refund for the duplicate charge request and note it on the account.
3. Reply to the customer confirming the refund before Friday, acknowledging the earlier unanswered email.`;

const BAD_OUTPUT = `The customer seems happy overall. We recommend upgrading them to the annual plan and offering a loyalty discount, since retention is trending upward this quarter.`;

const log = (...a) => console.log(...a);
const txUrl = (hash) => `${EXPLORER}/tx/${hash}`;

async function apiPost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${parsed.message ?? text}`);
  return parsed;
}

async function apiGet(path) {
  const res = await fetch(`${API}${path}`);
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${parsed.message ?? text}`);
  return parsed;
}

async function send(account, functionName, args, value) {
  const hash = await wallet(account).writeContract({
    address: CORE,
    abi,
    functionName,
    args,
    value,
    type: "legacy",
  });
  const receipt = await publicClient.waitForTransactionReceipt({hash, confirmations: 1});
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${txUrl(hash)}`);
  log(`   ${functionName.padEnd(22)} ${txUrl(hash)}`);
  return hash;
}

async function ensureOperatorReady() {
  const profile = await publicClient.readContract({
    address: CORE,
    abi,
    functionName: "getOperator",
    args: [operatorAccount.address],
  });

  const balance = await publicClient.getBalance({address: operatorAccount.address});
  const needed = STAKE + parseEther("0.02");
  if (balance < needed) {
    log(`\n-> funding demo operator ${operatorAccount.address}`);
    const hash = await wallet(buyerAccount).sendTransaction({
      to: operatorAccount.address,
      value: needed - balance,
      type: "legacy",
    });
    await publicClient.waitForTransactionReceipt({hash, confirmations: 1});
    log(`   fund                   ${txUrl(hash)}`);
  }

  if (profile.owner === "0x0000000000000000000000000000000000000000") {
    log("\n-> registering demo operator");
    return {register: await send(operatorAccount, "registerOperator", ["https://metrx.dev/operator/demo"], STAKE)};
  }

  const unlocked = profile.stake - profile.lockedStake;
  if (unlocked < MAX_SLASH) {
    log("\n-> topping up operator stake");
    return {addStake: await send(operatorAccount, "addStake", [], MAX_SLASH * 2n)};
  }
  return {};
}

async function runLifecycle(kind) {
  const expected = kind === "pass" ? "PASS" : "FAIL";
  const output = kind === "pass" ? GOOD_OUTPUT : BAD_OUTPUT;
  const txs = {};

  log(`\n${"=".repeat(70)}\n${expected} lifecycle\n${"=".repeat(70)}`);

  const config = await apiGet("/api/config");
  const spec = {...SPEC, modelId: config.verifier.modelId};
  log(`   verifier model         ${spec.modelId} (${config.verifier.provider}${config.verifier.mocked ? ", MOCK" : ""})`);
  if (!config.verifier.signerMatchesContract) {
    throw new Error("The API's verifier key does not match the address the contract trusts. Fix before running proof.");
  }

  const published = await apiPost("/api/artifacts", {kind: "job-spec", content: spec});
  const {jobSpecHash, inputHash, rubricHash, modelHash} = published.derived;
  log(`   jobSpecHash            ${jobSpecHash}`);

  const now = Math.floor(Date.now() / 1000);
  txs.createOrder = await send(
    buyerAccount,
    "createOrder",
    [jobSpecHash, inputHash, rubricHash, modelHash, BigInt(now + 3600), BigInt(now + 7200), MAX_SLASH],
    PRICE
  );

  const orderId = await publicClient.readContract({address: CORE, abi, functionName: "totalOrders"});
  log(`   order id               #${orderId}`);

  txs.acceptOrder = await send(operatorAccount, "acceptOrder", [orderId]);

  const deliveryArtifact = {orderId: orderId.toString(), output, submittedAt: Math.floor(Date.now() / 1000)};
  const delivery = await apiPost("/api/artifacts", {kind: "delivery", content: deliveryArtifact});
  txs.submitDelivery = await send(operatorAccount, "submitDelivery", [
    orderId,
    delivery.derived.outputHash,
    delivery.derived.deliveryArtifactHash,
  ]);

  log("\n-> running the AI verifier");
  const verdict = await apiPost(`/api/verify/${orderId}`, {});
  log(`   verdict                ${verdict.verdict} at ${(verdict.scoreBps / 100).toFixed(1)}%`);
  log(`   signed by              ${verdict.verifierAddress}`);
  log(`   reasonHash             ${verdict.reasonHash}`);
  log(`   reason                 ${verdict.reason.slice(0, 120)}…`);

  if (verdict.verdict !== expected) {
    throw new Error(`Expected a ${expected} verdict for the ${kind} run but the verifier returned ${verdict.verdict}.`);
  }

  txs.settle = await send(buyerAccount, "settleWithAIVerdict", [
    orderId,
    verdict.verdict === "PASS" ? 1 : 2,
    verdict.scoreBps,
    verdict.reasonHash,
    BigInt(verdict.evaluatedAt),
    verdict.signature,
  ]);

  const order = await publicClient.readContract({address: CORE, abi, functionName: "getOrder", args: [orderId]});
  const finalStatus = statusName(order.status);
  log(`\n   final status           ${finalStatus}`);

  const wanted = expected === "PASS" ? "Paid" : "Slashed";
  if (finalStatus !== wanted) throw new Error(`Expected terminal state ${wanted}, got ${finalStatus}.`);

  return {
    kind: expected,
    orderId: orderId.toString(),
    status: finalStatus,
    price: formatEther(PRICE),
    maxSlash: formatEther(MAX_SLASH),
    scoreBps: verdict.scoreBps,
    provider: verdict.provider,
    modelId: verdict.modelId,
    mocked: verdict.mocked,
    verifierAddress: verdict.verifierAddress,
    reasonHash: verdict.reasonHash,
    txs,
    proofUrl: `/proof/${orderId}`,
    explorer: Object.fromEntries(Object.entries(txs).map(([k, v]) => [k, txUrl(v)])),
  };
}

const mode = (process.argv[2] || "both").toLowerCase();

log(`\nMetrx mainnet proof run`);
log(`   contract  ${CORE}`);
log(`   chain     ${CHAIN_ID} via ${RPC}`);
log(`   api       ${API}`);
log(`   buyer     ${buyerAccount.address}`);
log(`   operator  ${operatorAccount.address}`);

const chainId = await publicClient.getChainId();
if (chainId !== CHAIN_ID) throw new Error(`RPC reports chain ${chainId}, expected ${CHAIN_ID}.`);

const buyerBalance = await publicClient.getBalance({address: buyerAccount.address});
log(`   buyer BOT ${formatEther(buyerBalance)}`);
if (buyerBalance < PRICE * 3n) {
  console.error(`\nFund this address with BOT on mainnet before running the proof: ${buyerAccount.address}\n`);
  process.exit(1);
}

const setup = await ensureOperatorReady();
const runs = [];
if (mode === "pass" || mode === "both") runs.push(await runLifecycle("pass"));
if (mode === "fail" || mode === "both") runs.push(await runLifecycle("fail"));

// Running one leg at a time must not erase the other. Prior runs of a different kind, and
// of a different contract, are kept so PROOF_RUNS.json stays a complete evidence file.
const previous = readJson(join(ROOT, "PROOF_RUNS.json"));
const carried = (previous?.runs ?? []).filter(
  (r) => r.kind !== undefined && !runs.some((fresh) => fresh.kind === r.kind)
);

const record = {
  generatedAt: new Date().toISOString(),
  chainId: CHAIN_ID,
  contract: CORE,
  buyer: buyerAccount.address,
  operator: operatorAccount.address,
  setup,
  runs: [...runs, ...carried].sort((a, b) => (a.kind < b.kind ? -1 : 1)),
};
writeFileSync(join(ROOT, "PROOF_RUNS.json"), `${JSON.stringify(record, null, 2)}\n`);

log(`\n${"=".repeat(70)}`);
for (const r of runs) {
  log(`${r.kind.padEnd(5)} order #${r.orderId}  ${r.status.padEnd(8)} settle ${txUrl(r.txs.settle)}`);
}
log(`\nWrote PROOF_RUNS.json\n`);
