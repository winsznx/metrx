import type {Hex} from "viem";
import {
  ZERO_HASH,
  explorerAddress,
  hashJson,
  hashText,
  outcomeOf,
  type DeliveryArtifact,
  type JobSpec,
  type VerifierReason,
} from "@metrx/shared";
import {
  coreAddress,
  readAiVerifier,
  readOrder,
  readOrderTimeline,
  readSettlementCertificate,
  serialiseOrder,
} from "./chain.js";
import {getArtifact, getRecord, parseArtifact, putRecord} from "./artifacts.js";
import type {Env} from "./env.js";

/**
 * Assembles the public evidence for one order.
 *
 * Every hash the contract stores is recomputed here from the published artifact, so the
 * page can show whether the artifact anyone can download is the artifact that was actually
 * settled against. A missing artifact is reported as missing, never silently skipped.
 */
const TERMINAL = ["Paid", "Refunded", "Slashed", "Cancelled"];

/**
 * A settled order's evidence is immutable, so it is assembled once and served from cache.
 *
 * Assembling costs a log scan, a transaction decode and seven keccak hashes. That is fine for
 * one reader and not fine for a judge's page under load: the worker exceeded its CPU budget and
 * threw under concurrency, which surfaced in the browser as a CORS failure. Terminal orders are
 * exactly the ones people re-read, so caching them removes the cost where it actually lands.
 */
export async function proofBundle(env: Env, orderId: bigint) {
  const cacheKey = `proof:${coreAddress(env).toLowerCase()}:${orderId}`;
  const cached = await getRecord<Record<string, unknown>>(env, cacheKey).catch(() => null);
  if (cached) return cached;

  const bundle = await assembleProofBundle(env, orderId);
  if (TERMINAL.includes(String((bundle.order as Record<string, unknown>).status))) {
    await putRecord(env, cacheKey, bundle, 60 * 60 * 24 * 365).catch(() => undefined);
  }
  return bundle;
}

async function assembleProofBundle(env: Env, orderId: bigint) {
  const [order, aiVerifier, timeline] = await Promise.all([
    readOrder(env, orderId),
    readAiVerifier(env),
    readOrderTimeline(env, orderId),
  ]);
  const core = coreAddress(env);

  const specRecord = order.jobSpecHash !== ZERO_HASH ? await getArtifact(env, order.jobSpecHash) : null;
  const deliveryRecord =
    order.deliveryArtifactHash !== ZERO_HASH ? await getArtifact(env, order.deliveryArtifactHash) : null;
  const reasonRecord = order.verdictReasonHash !== ZERO_HASH ? await getArtifact(env, order.verdictReasonHash) : null;

  const settlementTx = timeline.find((t) => t.event === "AIVerdictSettled")?.txHash ?? null;

  // Prefer the chain: the settlement calldata carries the real certificate for every settled
  // order, including ones this service never signed. The store is only a fallback.
  const certificate =
    order.verdictReasonHash === ZERO_HASH
      ? null
      : ((settlementTx ? await readSettlementCertificate(env, settlementTx, order) : null) ??
        (await getRecord<Record<string, unknown>>(env, `certificate:${order.verdictReasonHash.toLowerCase()}`)));

  const jobSpec = specRecord ? parseArtifact<JobSpec>(specRecord) : null;
  const delivery = deliveryRecord ? parseArtifact<DeliveryArtifact>(deliveryRecord) : null;
  const reason = reasonRecord ? parseArtifact<VerifierReason>(reasonRecord) : null;

  const check = (label: string, onChain: Hex, recomputed: Hex | null) => ({
    label,
    onChain,
    recomputed,
    matches: recomputed !== null && recomputed.toLowerCase() === onChain.toLowerCase(),
    /** Fetch the artifact and re-derive the hash yourself. */
    artifactUrl: `/api/artifacts/${onChain}`,
  });

  const hashChecks = [
    check("Job spec", order.jobSpecHash, jobSpec ? hashJson(jobSpec) : null),
    check("Job input", order.inputHash, jobSpec ? hashText(jobSpec.input) : null),
    check("Rubric", order.rubricHash, jobSpec ? hashJson(jobSpec.rubric) : null),
    check("Verifier model", order.modelHash, jobSpec ? hashText(jobSpec.modelId) : null),
    check("Delivered output", order.outputHash, delivery ? hashText(delivery.output) : null),
    check("Delivery artifact", order.deliveryArtifactHash, delivery ? hashJson(delivery) : null),
    check("AI verdict reason", order.verdictReasonHash, reason ? hashJson(reason) : null),
  ].filter((c) => c.onChain !== ZERO_HASH);

  return {
    orderId: orderId.toString(),
    chainId: Number(env.BOT_CHAIN_ID || 677),
    contract: core,
    aiVerifier,
    order: serialiseOrder(order),
    outcome: outcomeOf(order.status),
    jobSpec,
    delivery,
    reason,
    hashChecks,
    certificate,
    timeline,
    settlementTx,
    explorer: {
      contract: explorerAddress(core),
      buyer: explorerAddress(order.buyer),
      operator: explorerAddress(order.operator),
      verifier: explorerAddress(aiVerifier),
    },
    generatedAt: Date.now(),
  };
}
