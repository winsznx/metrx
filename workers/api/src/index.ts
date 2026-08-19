import {Hono} from "hono";
import {cors} from "hono/cors";
import type {Address, Hex} from "viem";
import {ZERO_HASH, hashJson, hashText, isTerminal, type DeliveryArtifact, type JobSpec} from "@metrx/shared";
import {ApiError, badRequest, notFound, type Env} from "./env.js";
import {backendName, getArtifact, parseArtifact, putArtifact, requireArtifact, type ArtifactKind} from "./artifacts.js";
import {coreAddress, readAiVerifier, readOrder, readOrders, readTotalOrders, serialiseOrder} from "./chain.js";
import {modelIdOf, modelHashOf, resolveProvider, verify} from "./aiVerifier.js";
import {serialiseTypedData, signVerdict, verifierAccount} from "./eip712.js";
import {proofBundle} from "./proof.js";

const app = new Hono<{Bindings: Env}>();

app.use("*", (c, next) =>
  cors({
    origin: c.env.ALLOWED_ORIGIN === "*" || !c.env.ALLOWED_ORIGIN ? "*" : c.env.ALLOWED_ORIGIN.split(","),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["content-type"],
    maxAge: 86_400,
  })(c, next)
);

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({error: err.code, message: err.message}, err.status as 400);
  console.error("unhandled", err);
  return c.json({error: "internal", message: err.message ?? "Unexpected worker error."}, 500);
});

const parseOrderId = (raw: string): bigint => {
  if (!/^\d+$/.test(raw)) throw badRequest("bad_order_id", "Order id must be a positive integer.");
  const id = BigInt(raw);
  if (id === 0n) throw badRequest("bad_order_id", "Order ids start at 1.");
  return id;
};

// ---------------------------------------------------------------------------
// Health and configuration
// ---------------------------------------------------------------------------

app.get("/api/health", (c) => c.json({ok: true, service: "metrx-api"}));

/**
 * Everything the web app needs to build an order that this verifier is able to judge —
 * in particular the model id, whose hash the buyer commits on-chain at creation time.
 */
app.get("/api/config", async (c) => {
  const env = c.env;
  const provider = resolveProvider(env);
  let verifierAddress: Address | null = null;
  let onChainVerifier: Address | null = null;
  let totalOrders = "0";

  try {
    verifierAddress = verifierAccount(env).address;
  } catch {
    verifierAddress = null;
  }
  try {
    onChainVerifier = await readAiVerifier(env);
    totalOrders = (await readTotalOrders(env)).toString();
  } catch {
    onChainVerifier = null;
  }

  return c.json({
    chainId: Number(env.BOT_CHAIN_ID || 677),
    contract: /^0x[0-9a-fA-F]{40}$/.test(env.METRX_CORE_ADDRESS || "") ? env.METRX_CORE_ADDRESS : null,
    totalOrders,
    verifier: {
      provider,
      modelId: modelIdOf(env),
      modelHash: modelHashOf(env),
      signerAddress: verifierAddress,
      onChainVerifier,
      /** True when the signer this worker holds is the one the contract will accept. */
      signerMatchesContract:
        !!verifierAddress && !!onChainVerifier && verifierAddress.toLowerCase() === onChainVerifier.toLowerCase(),
      canSign: !!verifierAddress,
      mocked: provider === "mock",
      /** True when the model enforces the verdict schema itself, so malformed output cannot occur. */
      schemaEnforced: provider === "groq" && /^openai\/gpt-oss-/.test(modelIdOf(env)),
    },
    artifactStore: backendName(env),
  });
});

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

const ARTIFACT_KINDS: ArtifactKind[] = ["job-spec", "delivery", "reason"];
const MAX_ARTIFACT_BYTES = 64 * 1024;

function deriveHashes(kind: ArtifactKind, content: unknown, hash: Hex) {
  if (kind === "job-spec") {
    const spec = content as JobSpec;
    return {
      jobSpecHash: hash,
      inputHash: hashText(spec.input ?? ""),
      rubricHash: hashJson(spec.rubric ?? []),
      modelHash: hashText(spec.modelId ?? ""),
    };
  }
  if (kind === "delivery") {
    const delivery = content as DeliveryArtifact;
    return {deliveryArtifactHash: hash, outputHash: hashText(delivery.output ?? "")};
  }
  return undefined;
}

app.post("/api/artifacts", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {kind?: string; content?: unknown} | null;
  if (!body || !body.kind || body.content === undefined) {
    throw badRequest("bad_body", "Expected a JSON body with `kind` and `content`.");
  }
  if (!ARTIFACT_KINDS.includes(body.kind as ArtifactKind)) {
    throw badRequest("bad_kind", `kind must be one of ${ARTIFACT_KINDS.join(", ")}.`);
  }
  const size = JSON.stringify(body.content).length;
  if (size > MAX_ARTIFACT_BYTES) {
    throw badRequest("too_large", `Artifacts are capped at ${MAX_ARTIFACT_BYTES} bytes in v1 (got ${size}).`);
  }

  const stored = await putArtifact(c.env, body.kind as ArtifactKind, body.content);

  // Some artifacts carry sub-parts that are separately committed on-chain. Returning those
  // hashes here means scripts and wallets never re-implement canonical hashing.
  const derived = deriveHashes(body.kind as ArtifactKind, body.content, stored.hash);

  return c.json({hash: stored.hash, kind: stored.kind, storedAt: stored.storedAt, store: backendName(c.env), derived});
});

app.get("/api/artifacts/:hash", async (c) => {
  const found = await getArtifact(c.env, c.req.param("hash"));
  if (!found) throw notFound("artifact_missing", "No artifact published under that hash.");
  return c.json(found);
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

app.get("/api/orders", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const orders = await readOrders(c.env, limit);
  return c.json({
    contract: coreAddress(c.env),
    total: (await readTotalOrders(c.env)).toString(),
    orders: orders.map(serialiseOrder),
  });
});

app.get("/api/orders/:id", async (c) => {
  const order = await readOrder(c.env, parseOrderId(c.req.param("id")));
  return c.json({order: serialiseOrder(order)});
});

// ---------------------------------------------------------------------------
// AI verification
// ---------------------------------------------------------------------------

/**
 * Runs the AI verifier against a delivered order and returns a signed, submit-ready
 * settlement certificate. It never broadcasts: the signature is handed back so a wallet
 * (or anyone at all) can submit `settleWithAIVerdict` themselves.
 */
/**
 * A signed certificate is deterministic for a given (order, output), so it is cached.
 *
 * Without this every page refresh burned a full completion on a shared model quota and
 * produced a *different* signature, because `evaluatedAt` moves and the reason hash moves
 * with it. A user who lost the tab between signing and settling could be unable to settle at
 * all once the quota ran out.
 */
const certKey = (orderId: bigint, outputHash: string) => `verdict:${orderId}:${outputHash.toLowerCase()}`;

async function cachedVerdict(env: Env, key: string): Promise<unknown | null> {
  if (!env.ARTIFACTS) return null;
  const raw = await env.ARTIFACTS.get(key);
  return raw ? JSON.parse(raw) : null;
}

/** Returns a previously signed certificate without spending model quota. */
app.get("/api/verify/:orderId", async (c) => {
  const orderId = parseOrderId(c.req.param("orderId"));
  const order = await readOrder(c.env, orderId);
  const cached = order.outputHash === ZERO_HASH ? null : await cachedVerdict(c.env, certKey(orderId, order.outputHash));
  if (!cached) throw notFound("no_verdict", "No verdict has been signed for this order yet.");
  return c.json(cached);
});

app.post("/api/verify/:orderId", async (c) => {
  const env = c.env;
  const orderId = parseOrderId(c.req.param("orderId"));
  const core = coreAddress(env);
  const order = await readOrder(env, orderId);

  const cacheKey = order.outputHash === ZERO_HASH ? null : certKey(orderId, order.outputHash);
  if (cacheKey) {
    const cached = await cachedVerdict(env, cacheKey);
    if (cached) return c.json(cached);
  }

  if (order.status !== "Delivered") {
    throw badRequest(
      "not_delivered",
      `Order ${orderId} is ${order.status}. A verdict can only be produced for a delivered order.`
    );
  }
  const now = Math.floor(Date.now() / 1000);
  if (now > Number(order.verificationDeadline)) {
    throw badRequest(
      "verification_closed",
      "The verification window has closed. This order can now only be refunded via finalizeVerifierTimeout."
    );
  }

  // 1. Fetch the published artifacts the on-chain hashes point at.
  const specRecord = await requireArtifact(env, order.jobSpecHash, "job spec");
  const deliveryRecord = await requireArtifact(env, order.deliveryArtifactHash, "delivery");
  const jobSpec = parseArtifact<JobSpec>(specRecord);
  const delivery = parseArtifact<DeliveryArtifact>(deliveryRecord);

  // 2. Refuse to judge anything that does not reproduce the on-chain commitments.
  const mismatches = [
    ["jobSpecHash", order.jobSpecHash, hashJson(jobSpec)],
    ["inputHash", order.inputHash, hashText(jobSpec.input)],
    ["rubricHash", order.rubricHash, hashJson(jobSpec.rubric)],
    ["modelHash", order.modelHash, hashText(jobSpec.modelId)],
    ["outputHash", order.outputHash, hashText(delivery.output)],
  ].filter(([, onChain, recomputed]) => (onChain as string).toLowerCase() !== (recomputed as string).toLowerCase());

  if (mismatches.length > 0) {
    throw badRequest(
      "artifact_mismatch",
      `Published artifacts do not reproduce the on-chain commitments: ${mismatches
        .map(([label, onChain, recomputed]) => `${label} is ${onChain} on chain but ${recomputed} off chain`)
        .join("; ")}.`
    );
  }

  // 3. Run the model.
  const result = await verify(
    env,
    {
      orderId: orderId.toString(),
      jobSpec,
      rubric: jobSpec.rubric,
      inputSummary: jobSpec.input.slice(0, 280),
      output: delivery.output,
      jobSpecHash: order.jobSpecHash,
      inputHash: order.inputHash,
      rubricHash: order.rubricHash,
      modelHash: order.modelHash,
      outputHash: order.outputHash,
    },
    Number(order.deliveredAt)
  );

  // 4. Publish the reason so `reasonHash` is independently checkable, then sign.
  const stored = await putArtifact(env, "reason", result.reasonArtifact);
  if (stored.hash.toLowerCase() !== result.reasonHash.toLowerCase()) {
    throw badRequest("reason_hash_drift", "Reason artifact hash did not reproduce. Refusing to sign.");
  }

  const evaluatedAt = result.reasonArtifact.evaluatedAt;
  const {signature, digest, verifierAddress, typedData} = await signVerdict(env, core, Number(env.BOT_CHAIN_ID || 677), {
    orderId,
    jobSpecHash: order.jobSpecHash,
    inputHash: order.inputHash,
    rubricHash: order.rubricHash,
    modelHash: order.modelHash,
    outputHash: order.outputHash,
    verdict: result.verdict,
    scoreBps: result.scoreBps,
    reasonHash: result.reasonHash,
    evaluatedAt,
  });

  const response = {
    orderId: orderId.toString(),
    verdict: result.verdict,
    scoreBps: result.scoreBps,
    reason: result.reason,
    reasonHash: result.reasonHash,
    rubricFindings: result.rubricFindings,
    modelId: result.modelId,
    modelHash: result.modelHash,
    provider: result.provider,
    mocked: result.mocked,
    rateLimit: result.rateLimit,
    evaluatedAt,
    signature,
    digest,
    verifierAddress,
    typedData: serialiseTypedData(typedData),
    reasonArtifact: result.reasonArtifact,
    submit: {
      address: core,
      functionName: "settleWithAIVerdict",
      args: [
        orderId.toString(),
        result.verdict === "PASS" ? 1 : 2,
        result.scoreBps,
        result.reasonHash,
        evaluatedAt,
        signature,
      ],
    },
  };

  // Cached against the committed output hash: a redelivery is impossible on a delivered order,
  // so this can never serve a certificate for output the contract did not commit.
  if (cacheKey && env.ARTIFACTS) {
    await env.ARTIFACTS.put(cacheKey, JSON.stringify(response), {expirationTtl: 60 * 60 * 24 * 30});
  }

  return c.json(response);
});

// ---------------------------------------------------------------------------
// Public proof
// ---------------------------------------------------------------------------

app.get("/api/proof/:orderId", async (c) => {
  const bundle = await proofBundle(c.env, parseOrderId(c.req.param("orderId")));
  return c.json(bundle);
});

app.get("/api/proof", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 25) || 25, 100);
  const orders = await readOrders(c.env, limit);
  const settled = orders.filter((o) => isTerminal(o.status));
  return c.json({
    contract: coreAddress(c.env),
    aiVerifier: await readAiVerifier(c.env),
    counts: {
      total: orders.length,
      paid: settled.filter((o) => o.status === "Paid").length,
      slashed: settled.filter((o) => o.status === "Slashed").length,
      refunded: settled.filter((o) => o.status === "Refunded").length,
    },
    orders: orders.map(serialiseOrder),
  });
});

app.notFound((c) => c.json({error: "not_found", message: `No route for ${c.req.method} ${c.req.path}.`}, 404));

export default app;
