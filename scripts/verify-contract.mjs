#!/usr/bin/env node
// Verifies MetrxCore source on BOTScan (Blockscout / Etherscan-compatible at /api).
// Run after `pnpm contracts:deploy`.

import {execFileSync} from "node:child_process";
import {join} from "node:path";
import {loadEnv, require_, ROOT} from "./lib/env.mjs";

const env = loadEnv();
const core = require_(env, "METRX_CORE_ADDRESS", "Deploy first with `pnpm contracts:deploy`.");
const verifier = require_(env, "AI_VERIFIER_ADDRESS");
const explorerApi = env.BOT_EXPLORER_API || "https://scan.botchain.ai/api";
const chainId = env.BOT_CHAIN_ID || "677";

const constructorArgs = execFileSync("cast", ["abi-encode", "constructor(address)", verifier], {
  encoding: "utf8",
}).trim();

const args = [
  "verify-contract",
  core,
  "src/MetrxCore.sol:MetrxCore",
  "--chain-id",
  chainId,
  "--verifier",
  "blockscout",
  "--verifier-url",
  explorerApi,
  "--constructor-args",
  constructorArgs,
  "--compiler-version",
  "0.8.28",
  "--watch",
];

console.log(`\nVerifying ${core} on ${explorerApi}\n  constructor args ${constructorArgs}\n`);

try {
  execFileSync("forge", args, {cwd: join(ROOT, "contracts"), stdio: "inherit", env: {...process.env, ...env}});
  console.log("\nVerified. Confirm at https://scan.botchain.ai/address/" + core + "#code\n");
} catch {
  console.error(
    "\nBlockscout verification failed. Retry with the Etherscan-compatible verifier:\n" +
      `  cd contracts && forge verify-contract ${core} src/MetrxCore.sol:MetrxCore \\\n` +
      `    --chain-id ${chainId} --verifier etherscan --verifier-url ${explorerApi} \\\n` +
      `    --etherscan-api-key "$SCAN_API_KEY" --constructor-args ${constructorArgs} --compiler-version 0.8.28\n`
  );
  process.exit(1);
}
