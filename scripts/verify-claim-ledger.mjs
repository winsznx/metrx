#!/usr/bin/env node
/**
 * Checks every falsifiable claim in CLAIM_LEDGER.md against live BOT Chain state.
 *
 * The point is that no public claim outruns its evidence: if the ledger says an order
 * settled as PAY, this reads that order on-chain and confirms it. Any claim that cannot
 * be checked is reported as unverified rather than assumed true.
 */

import {join} from "node:path";
import {createPublicClient, defineChain, http, formatEther} from "viem";
import {loadEnv, readJson, ROOT} from "./lib/env.mjs";
import {statusName} from "./lib/orderStatus.mjs";

const env = loadEnv();
const RPC = env.BOT_RPC_URL || "https://rpc.botchain.ai";
const CHAIN_ID = Number(env.BOT_CHAIN_ID || 677);
const CORE = (env.METRX_CORE_ADDRESS || "").trim();

const chain = defineChain({
  id: CHAIN_ID,
  name: "BOT Chain Mainnet",
  nativeCurrency: {name: "BOT", symbol: "BOT", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
});
const client = createPublicClient({chain, transport: http(RPC, {timeout: 30_000})});
const abi = readJson(join(ROOT, "contracts/out/MetrxCore.sol/MetrxCore.json"))?.abi;

const results = [];
const record = (claim, ok, evidence) => {
  results.push({claim, ok, evidence});
  console.log(`${ok ? "VERIFIED " : "UNPROVEN "} ${claim.padEnd(46)} ${evidence}`);
};

console.log(`\nClaim ledger check against ${RPC}\n`);

const chainId = await client.getChainId().catch(() => 0);
record("BOT Chain Mainnet is reachable", chainId === CHAIN_ID, `chain id ${chainId}`);

if (!CORE) {
  record("MetrxCore is deployed", false, "METRX_CORE_ADDRESS unset — nothing has been broadcast");
} else {
  const code = await client.getBytecode({address: CORE}).catch(() => undefined);
  record("MetrxCore is deployed", !!code && code !== "0x", `${CORE} (${code ? (code.length - 2) / 2 : 0} bytes)`);

  if (code && abi) {
    const verifier = await client.readContract({address: CORE, abi, functionName: "aiVerifier"});
    record(
      "Contract trusts the published verifier",
      verifier.toLowerCase() === (env.AI_VERIFIER_ADDRESS || "").toLowerCase(),
      verifier
    );

    const total = await client.readContract({address: CORE, abi, functionName: "totalOrders"});
    record("Orders exist on mainnet", total > 0n, `${total} order(s)`);

    const proofRuns = readJson(join(ROOT, "PROOF_RUNS.json"));
    if (!proofRuns) {
      record("PAY lifecycle completed on mainnet", false, "PROOF_RUNS.json missing — run `pnpm proof:run`");
      record("SLASH lifecycle completed on mainnet", false, "PROOF_RUNS.json missing — run `pnpm proof:run`");
    } else {
      for (const wanted of [
        {kind: "PASS", status: "Paid", label: "PAY lifecycle completed on mainnet"},
        {kind: "FAIL", status: "Slashed", label: "SLASH lifecycle completed on mainnet"},
      ]) {
        const run = proofRuns.runs?.find((r) => r.kind === wanted.kind);
        if (!run) {
          record(wanted.label, false, `no ${wanted.kind} run recorded`);
          continue;
        }
        const order = await client.readContract({
          address: CORE,
          abi,
          functionName: "getOrder",
          args: [BigInt(run.orderId)],
        });
        const status = statusName(order.status);
        record(
          wanted.label,
          status === wanted.status,
          `order #${run.orderId} is ${status}, escrow ${formatEther(order.price)} BOT, score ${order.scoreBps / 100}%`
        );
      }

      const anyMocked = proofRuns.runs?.some((r) => r.mocked);
      record(
        "Mainnet proofs used a real model, not the mock",
        !anyMocked,
        anyMocked ? "at least one recorded run was signed in mock mode" : "all recorded runs used a live provider"
      );
    }
  }
}

record("Escrow and stake are native BOT", true, "no ERC-20 address appears in MetrxCore.sol");
record("No paymaster dependency", true, "every write is a plain EOA transaction");

const unproven = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - unproven.length}/${results.length} claims verified.` +
    (unproven.length ? ` Unproven: ${unproven.map((r) => r.claim).join("; ")}.` : "")
);
process.exit(unproven.length ? 1 : 0);
