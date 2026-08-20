import {privateKeyToAccount} from "viem/accounts";
import {hashTypedData, type Address, type Hex} from "viem";
import {AI_VERDICT_TYPES, aiVerdictDomain, VERDICT_FAIL, VERDICT_PASS} from "@metrx/shared";
import {misconfigured, type Env} from "./env.js";

export interface VerdictCertificate {
  orderId: bigint;
  jobSpecHash: Hex;
  inputHash: Hex;
  rubricHash: Hex;
  modelHash: Hex;
  outputHash: Hex;
  verdict: "PASS" | "FAIL";
  scoreBps: number;
  reasonHash: Hex;
  evaluatedAt: number;
}

/**
 * Deriving an account from a private key runs a secp256k1 point multiplication. Config,
 * every signature and every re-verification hits this, so the result is memoised per key.
 * The derivation is pure and an isolate only ever holds one verifier key, so repeating it on
 * every request was pure CPU cost — the dominant one on the otherwise-cheap config path.
 */
const accountCache = new Map<string, ReturnType<typeof privateKeyToAccount>>();

export function verifierAccount(env: Env) {
  const pk = (env.AI_VERIFIER_PRIVATE_KEY || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw misconfigured(
      "verifier_key_missing",
      "AI_VERIFIER_PRIVATE_KEY is not configured on this worker, so no verdict can be signed."
    );
  }
  let account = accountCache.get(pk);
  if (!account) {
    account = privateKeyToAccount(pk as Hex);
    accountCache.set(pk, account);
  }
  return account;
}

const verdictCode = (v: "PASS" | "FAIL") => (v === "PASS" ? VERDICT_PASS : VERDICT_FAIL);

export function typedDataFor(core: Address, chainId: number, cert: VerdictCertificate) {
  return {
    domain: aiVerdictDomain(core, chainId),
    types: AI_VERDICT_TYPES,
    primaryType: "AIVerdict" as const,
    message: {
      orderId: cert.orderId,
      jobSpecHash: cert.jobSpecHash,
      inputHash: cert.inputHash,
      rubricHash: cert.rubricHash,
      modelHash: cert.modelHash,
      outputHash: cert.outputHash,
      verdict: verdictCode(cert.verdict),
      scoreBps: cert.scoreBps,
      reasonHash: cert.reasonHash,
      evaluatedAt: BigInt(cert.evaluatedAt),
    },
  };
}

/**
 * Signs the AIVerdict certificate the settlement contract will enforce.
 *
 * The signature covers the order id and every hash already committed on-chain, so the
 * certificate is worthless anywhere except this exact order, spec, rubric, model and output.
 */
export async function signVerdict(
  env: Env,
  core: Address,
  chainId: number,
  cert: VerdictCertificate
): Promise<{signature: Hex; digest: Hex; verifierAddress: Address; typedData: ReturnType<typeof typedDataFor>}> {
  const account = verifierAccount(env);
  const typedData = typedDataFor(core, chainId, cert);
  const signature = await account.signTypedData(typedData);
  return {signature, digest: hashTypedData(typedData), verifierAddress: account.address, typedData};
}

/** JSON-safe view of the typed data, for the proof page and for wallet-side re-verification. */
export function serialiseTypedData(td: ReturnType<typeof typedDataFor>) {
  return {
    domain: {...td.domain},
    types: td.types as unknown as Record<string, {name: string; type: string}[]>,
    primaryType: td.primaryType,
    message: Object.fromEntries(
      Object.entries(td.message).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])
    ) as Record<string, string | number>,
  };
}
