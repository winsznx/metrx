#!/usr/bin/env node
// Generates the deployer and AI verifier keypairs into a local .env file.
// Existing values are never overwritten. Private keys stay on this machine.

import {execFileSync} from "node:child_process";
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");

function newWallet() {
  const out = execFileSync("cast", ["wallet", "new"], {encoding: "utf8"});
  const address = out.match(/Address:\s+(0x[0-9a-fA-F]{40})/)?.[1];
  const privateKey = out.match(/Private key:\s+(0x[0-9a-fA-F]{64})/)?.[1];
  if (!address || !privateKey) throw new Error(`could not parse \`cast wallet new\` output:\n${out}`);
  return {address, privateKey};
}

function parseEnv(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function upsert(text, key, value) {
  const line = `${key}=${value}`;
  return new RegExp(`^${key}=.*$`, "m").test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${text.replace(/\n*$/, "\n")}${line}\n`;
}

let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : readFileSync(join(root, ".env.example"), "utf8");
const current = parseEnv(env);

const summary = [];

if (!current.get("DEPLOYER_PRIVATE_KEY")) {
  const w = newWallet();
  env = upsert(env, "DEPLOYER_PRIVATE_KEY", w.privateKey);
  env = upsert(env, "DEPLOYER_ADDRESS", w.address);
  summary.push(["Deployer address", w.address, "generated"]);
} else {
  const address =
    current.get("DEPLOYER_ADDRESS") ||
    execFileSync("cast", ["wallet", "address", "--private-key", current.get("DEPLOYER_PRIVATE_KEY")], {
      encoding: "utf8",
    }).trim();
  env = upsert(env, "DEPLOYER_ADDRESS", address);
  summary.push(["Deployer address", address, "existing"]);
}

if (!current.get("DEMO_OPERATOR_PRIVATE_KEY")) {
  const w = newWallet();
  env = upsert(env, "DEMO_OPERATOR_PRIVATE_KEY", w.privateKey);
  env = upsert(env, "DEMO_OPERATOR_ADDRESS", w.address);
  summary.push(["Demo operator address", w.address, "generated"]);
} else {
  const address =
    current.get("DEMO_OPERATOR_ADDRESS") ||
    execFileSync("cast", ["wallet", "address", "--private-key", current.get("DEMO_OPERATOR_PRIVATE_KEY")], {
      encoding: "utf8",
    }).trim();
  env = upsert(env, "DEMO_OPERATOR_ADDRESS", address);
  summary.push(["Demo operator address", address, "existing"]);
}

if (!current.get("AI_VERIFIER_PRIVATE_KEY")) {
  const w = newWallet();
  env = upsert(env, "AI_VERIFIER_PRIVATE_KEY", w.privateKey);
  env = upsert(env, "AI_VERIFIER_ADDRESS", w.address);
  summary.push(["AI verifier address", w.address, "generated"]);
} else {
  const address =
    current.get("AI_VERIFIER_ADDRESS") ||
    execFileSync("cast", ["wallet", "address", "--private-key", current.get("AI_VERIFIER_PRIVATE_KEY")], {
      encoding: "utf8",
    }).trim();
  env = upsert(env, "AI_VERIFIER_ADDRESS", address);
  summary.push(["AI verifier address", address, "existing"]);
}

writeFileSync(envPath, env, {mode: 0o600});

console.log("");
for (const [label, address, state] of summary) {
  console.log(`${label.padEnd(22)} ${address}  (${state})`);
}
console.log("");
console.log("Private keys written to .env (gitignored, mode 600).");
console.log("The deployer needs native BOT on chain 677 before any broadcast.");
console.log("The AI verifier signs certificates off-chain and needs no balance.");
