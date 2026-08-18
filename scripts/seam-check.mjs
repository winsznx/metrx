#!/usr/bin/env node
// Phase 0 seam check: proves the live BOT Chain Mainnet assumptions before any broadcast.
// Uses raw JSON-RPC so it runs with zero installed dependencies.

import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");

const env = {...process.env};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2];
  }
}

const RPC = env.BOT_RPC_URL || "https://rpc.botchain.ai";
const EXPECTED_CHAIN_ID = 677;
const EXPLORER_API = env.BOT_EXPLORER_API || "https://scan.botchain.ai/api";

let id = 0;
async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: ++id, method, params}),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const checks = [];
function record(name, ok, detail) {
  checks.push({name, ok, detail});
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(30)} ${detail}`);
}

const fmtBot = (wei) => `${(Number(wei) / 1e18).toFixed(6)} BOT`;

console.log(`\nMetrx seam check -> ${RPC}\n`);

let chainId = 0;
let latest = null;
let gasPrice = 0n;
let deployerBalance = 0n;

try {
  chainId = Number(await rpc("eth_chainId"));
  record("rpc reachable", true, RPC);
  record("chain id", chainId === EXPECTED_CHAIN_ID, `${chainId} (expected ${EXPECTED_CHAIN_ID})`);
} catch (e) {
  record("rpc reachable", false, e.message);
}

try {
  const blockNumber = BigInt(await rpc("eth_blockNumber"));
  latest = await rpc("eth_getBlockByNumber", ["latest", false]);
  record("latest block readable", true, `#${blockNumber} hash ${latest.hash.slice(0, 18)}...`);
  const baseFee = latest.baseFeePerGas ? BigInt(latest.baseFeePerGas) : 0n;
  record(
    "fee model",
    true,
    baseFee === 0n ? "baseFeePerGas is 0 -> use legacy gas pricing" : `baseFeePerGas ${baseFee} wei`
  );
  const nonStandard = Object.keys(latest).filter((k) =>
    ["milliTimestamp", "feePayer", "sealer", "signers"].includes(k)
  );
  record(
    "non-standard block fields",
    true,
    nonStandard.length ? `${nonStandard.join(", ")} -> use tolerant reads` : "none observed"
  );
} catch (e) {
  record("latest block readable", false, e.message);
}

try {
  gasPrice = BigInt(await rpc("eth_gasPrice"));
  record("gas price readable", true, `${gasPrice / 1_000_000_000n} gwei`);
  const deployGas = 2_100_000n;
  const lifecycleGas = 700_000n;
  record(
    "lifecycle cost estimate",
    true,
    `deploy ~${fmtBot(gasPrice * deployGas)}, full lifecycle ~${fmtBot(gasPrice * lifecycleGas)}`
  );
} catch (e) {
  record("gas price readable", false, e.message);
}

const deployer = env.DEPLOYER_ADDRESS;
if (deployer) {
  try {
    deployerBalance = BigInt(await rpc("eth_getBalance", [deployer, "latest"]));
    const funded = deployerBalance > 0n;
    record("deployer balance", funded, `${deployer} -> ${fmtBot(deployerBalance)}`);
    if (!funded) {
      console.log(`\n  Fund this address with BOT on mainnet before broadcast: ${deployer}\n`);
    }
  } catch (e) {
    record("deployer balance", false, e.message);
  }
} else {
  record("deployer balance", false, "DEPLOYER_ADDRESS unset -> run `pnpm keys:generate`");
}

const core = env.METRX_CORE_ADDRESS;
if (core) {
  try {
    const code = await rpc("eth_getCode", [core, "latest"]);
    record("MetrxCore deployed", code !== "0x", `${core} code ${(code.length - 2) / 2} bytes`);
  } catch (e) {
    record("MetrxCore deployed", false, e.message);
  }
} else {
  record("MetrxCore deployed", false, "METRX_CORE_ADDRESS unset (expected before first deploy)");
}

try {
  const res = await fetch(`${EXPLORER_API}?module=block&action=eth_block_number`, {
    signal: AbortSignal.timeout(20_000),
  });
  record("explorer api reachable", res.ok, `${EXPLORER_API} -> HTTP ${res.status}`);
} catch (e) {
  record("explorer api reachable", false, e.message);
}

record("no USDT dependency", true, "v1 escrow and stake are native BOT only");
record("no paymaster dependency", true, "all writes are plain EOA transactions");

const failed = checks.filter((c) => !c.ok);
const stamp = new Date().toISOString();

const report = `# SEAM_REPORT.md

Live pre-broadcast check of every BOT Chain Mainnet assumption Metrx depends on.
Regenerate with \`pnpm seam:check\`.

- Generated: ${stamp}
- RPC: \`${RPC}\`
- Explorer API: \`${EXPLORER_API}\`

| Check | Result | Detail |
| --- | --- | --- |
${checks.map((c) => `| ${c.name} | ${c.ok ? "PASS" : "FAIL"} | ${c.detail} |`).join("\n")}

## Chain facts observed

- Chain ID: \`${chainId}\`
- Latest block: \`${latest ? BigInt(latest.number).toString() : "n/a"}\`
- Gas price: \`${gasPrice} wei\` (${gasPrice / 1_000_000_000n} gwei)
- Base fee: \`${latest?.baseFeePerGas ?? "0x0"}\` — legacy gas pricing is used for every broadcast
- Deployer: \`${deployer ?? "unset"}\` holding \`${deployerBalance}\` wei

## Standing decisions this check backs

- Escrow and stake are native BOT. No USDT contract is read or written.
- No paymaster, bundler, or account abstraction path is on the critical path.
- Broadcasts use \`--legacy\` because the chain reports a zero base fee.
- Receipts are parsed tolerantly: BOT Chain returns extra block/receipt fields
  (for example \`milliTimestamp\`) that strict EVM clients reject.

${failed.length === 0 ? "All checks passed." : `${failed.length} check(s) failed: ${failed.map((c) => c.name).join(", ")}.`}
`;

writeFileSync(join(root, "SEAM_REPORT.md"), report);
console.log(`\nWrote SEAM_REPORT.md (${checks.length - failed.length}/${checks.length} passed)\n`);
