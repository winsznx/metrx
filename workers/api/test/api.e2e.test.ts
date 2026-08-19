import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {spawn, type ChildProcess} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import app from "../src/index.js";
import type {Env} from "../src/env.js";

/**
 * Full product loop through the real worker routes:
 * publish artifacts -> fund -> accept -> deliver -> POST /api/verify -> settle on chain
 * -> GET /api/proof and confirm every published artifact still reproduces its on-chain hash.
 *
 * Runs against a local anvil node so the loop is exercised without spending mainnet BOT.
 */

const PORT = 8551;
const RPC = `http://127.0.0.1:${PORT}`;

const chain = defineChain({
  id: 31337,
  name: "anvil",
  nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
});

const BUYER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const OPERATOR_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;
const VERIFIER_PK = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;

const MODEL_ID = "metrx-mock-verifier-v1";

const artifact = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../contracts/out/MetrxCore.sol/MetrxCore.json", import.meta.url)), "utf8")
);

let anvil: ChildProcess;
let publicClient: PublicClient;
let core: Address;
let env: Env;

const wallet = (pk: Hex) => createWalletClient({account: privateKeyToAccount(pk), chain, transport: http(RPC)});

const call = async (path: string, init?: RequestInit) =>
  app.fetch(new Request(`https://metrx.test${path}`, init), env as never);

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

async function waitForRpc(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_chainId", params: []}),
      });
      if (res.ok) return;
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("anvil did not start");
}

beforeAll(async () => {
  anvil = spawn("anvil", ["--port", String(PORT), "--silent"], {stdio: "ignore"});
  await waitForRpc();

  publicClient = createPublicClient({chain, transport: http(RPC)}) as PublicClient;
  const buyer = wallet(BUYER_PK);

  const hash = await buyer.deployContract({
    account: buyer.account,
    chain,
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
    args: [privateKeyToAccount(VERIFIER_PK).address],
  });
  core = (await publicClient.waitForTransactionReceipt({hash})).contractAddress!;

  env = {
    BOT_RPC_URL: RPC,
    BOT_CHAIN_ID: "31337",
    METRX_CORE_ADDRESS: core,
    METRX_DEPLOY_BLOCK: "0",
    AI_PROVIDER: "mock",
    AI_MODEL_ID: MODEL_ID,
    ALLOWED_ORIGIN: "*",
    AI_VERIFIER_PRIVATE_KEY: VERIFIER_PK,
  };
}, 60_000);

afterAll(() => anvil?.kill());

/** Drives an order to Delivered and returns its id. `output` decides how the mock verifier scores it. */
async function orderThroughDelivery(rubric: string[], output: string) {
  const spec = {
    title: "Summarize a support ticket",
    taskType: "text-eval",
    instructions: "Summarize this ticket into exactly three action items.",
    input: "Customer was charged twice in October and wants a duplicate charge refund confirmed by Friday.",
    rubric,
    modelId: MODEL_ID,
  };

  const specRes = await json<{hash: Hex}>(
    await call("/api/artifacts", {method: "POST", body: JSON.stringify({kind: "job-spec", content: spec})})
  );

  const buyer = wallet(BUYER_PK);
  const operator = wallet(OPERATOR_PK);
  const now = Math.floor(Date.now() / 1000);

  const registered = (await publicClient.readContract({
    address: core,
    abi: artifact.abi,
    functionName: "getOperator",
    args: [operator.account.address],
  })) as {owner: Address};

  if (registered.owner === "0x0000000000000000000000000000000000000000") {
    await publicClient.waitForTransactionReceipt({
      hash: await operator.writeContract({
        account: operator.account,
        chain,
        address: core,
        abi: artifact.abi,
        functionName: "registerOperator",
        args: [""],
        value: parseEther("5"),
      }),
    });
  }

  // Hashes are computed by the worker's own helpers via the artifact store, so committing
  // `specRes.hash` here is exactly the value the verifier will later look up.
  const {hashJson, hashText} = await import("@metrx/shared");
  await publicClient.waitForTransactionReceipt({
    hash: await buyer.writeContract({
      account: buyer.account,
      chain,
      address: core,
      abi: artifact.abi,
      functionName: "createOrder",
      args: [
        specRes.hash,
        hashText(spec.input),
        hashJson(spec.rubric),
        hashText(spec.modelId),
        BigInt(now + 3600),
        BigInt(now + 7200),
        parseEther("0.5"),
      ],
      value: parseEther("1"),
    }),
  });

  const orderId = (await publicClient.readContract({
    address: core,
    abi: artifact.abi,
    functionName: "totalOrders",
  })) as bigint;

  const deliveryArtifact = {orderId: orderId.toString(), output, submittedAt: now};
  const deliveryRes = await json<{hash: Hex}>(
    await call("/api/artifacts", {
      method: "POST",
      body: JSON.stringify({kind: "delivery", content: deliveryArtifact}),
    })
  );

  await publicClient.waitForTransactionReceipt({
    hash: await operator.writeContract({
      account: operator.account,
      chain,
      address: core,
      abi: artifact.abi,
      functionName: "acceptOrder",
      args: [orderId],
    }),
  });
  await publicClient.waitForTransactionReceipt({
    hash: await operator.writeContract({
      account: operator.account,
      chain,
      address: core,
      abi: artifact.abi,
      functionName: "submitDelivery",
      args: [orderId, hashText(output), deliveryRes.hash],
    }),
  });

  return orderId;
}

interface VerifyResponse {
  verdict: "PASS" | "FAIL";
  scoreBps: number;
  reasonHash: Hex;
  signature: Hex;
  evaluatedAt: number;
  mocked: boolean;
  verifierAddress: Address;
  submit: {args: [string, number, number, Hex, number, Hex]};
}

async function settle(orderId: bigint, v: VerifyResponse) {
  const submitter = wallet(BUYER_PK);
  const hash = await submitter.writeContract({
    account: submitter.account,
    chain,
    address: core,
    abi: artifact.abi,
    functionName: "settleWithAIVerdict",
    args: [orderId, v.submit.args[1], v.submit.args[2], v.reasonHash, BigInt(v.evaluatedAt), v.signature],
  });
  return publicClient.waitForTransactionReceipt({hash});
}

describe("worker API", () => {
  it("reports the model whose hash buyers must commit", async () => {
    const config = await json<{verifier: {modelId: string; signerMatchesContract: boolean; mocked: boolean}}>(
      await call("/api/config")
    );
    expect(config.verifier.modelId).toBe(MODEL_ID);
    expect(config.verifier.signerMatchesContract).toBe(true);
    expect(config.verifier.mocked).toBe(true);
  });

  it("stores artifacts under the hash that was committed on chain", async () => {
    const res = await json<{hash: Hex}>(
      await call("/api/artifacts", {method: "POST", body: JSON.stringify({kind: "delivery", content: {a: 1}})})
    );
    const fetched = await json<{body: string}>(await call(`/api/artifacts/${res.hash}`));
    expect(JSON.parse(fetched.body)).toEqual({a: 1});
  });

  it("runs the full PAY loop: verify, sign, settle, then prove", async () => {
    const orderId = await orderThroughDelivery(
      ["Output must mention the duplicate charge refund", "Output must list three action items"],
      "Three action items: 1) confirm the duplicate charge, 2) issue the refund, 3) reply before Friday."
    );

    const verdict = await json<VerifyResponse>(await call(`/api/verify/${orderId}`, {method: "POST", body: "{}"}));
    expect(verdict.verdict).toBe("PASS");
    expect(verdict.mocked).toBe(true);
    expect(verdict.verifierAddress).toBe(privateKeyToAccount(VERIFIER_PK).address);

    const receipt = await settle(orderId, verdict);
    expect(receipt.status).toBe("success");

    const proof = await json<{
      outcome: string;
      hashChecks: {label: string; matches: boolean}[];
      reason: {verdict: string} | null;
    }>(await call(`/api/proof/${orderId}`));

    expect(proof.outcome).toBe("PAY");
    expect(proof.reason?.verdict).toBe("PASS");
    expect(proof.hashChecks.length).toBeGreaterThanOrEqual(6);
    expect(proof.hashChecks.every((c) => c.matches)).toBe(true);
  }, 60_000);

  it("runs the full SLASH loop when the output misses the rubric", async () => {
    const orderId = await orderThroughDelivery(
      ["Output must mention the duplicate charge refund", "Output must include a Friday confirmation deadline"],
      "Everything looks fine here."
    );

    const verdict = await json<VerifyResponse>(await call(`/api/verify/${orderId}`, {method: "POST", body: "{}"}));
    expect(verdict.verdict).toBe("FAIL");

    const receipt = await settle(orderId, verdict);
    expect(receipt.status).toBe("success");

    const proof = await json<{outcome: string; hashChecks: {matches: boolean}[]}>(await call(`/api/proof/${orderId}`));
    expect(proof.outcome).toBe("SLASH");
    expect(proof.hashChecks.every((c) => c.matches)).toBe(true);
  }, 60_000);

  it("refuses to judge an order that has not been delivered", async () => {
    const res = await call("/api/verify/999999", {method: "POST", body: "{}"});
    expect(res.status).toBe(404);
    expect((await json<{error: string}>(res)).error).toBe("unknown_order");
  });

  it("serves a cached certificate instead of re-running the model", async () => {
    const orderId = await orderThroughDelivery(
      ["Output must mention the duplicate charge refund"],
      "The duplicate charge refund has been issued."
    );

    const first = await json<VerifyResponse>(await call(`/api/verify/${orderId}`, {method: "POST", body: "{}"}));
    const second = await json<VerifyResponse>(await call(`/api/verify/${orderId}`, {method: "POST", body: "{}"}));

    // A fresh run would move evaluatedAt, which moves reasonHash, which moves the signature —
    // and would leave a settled-but-unsettleable order if quota ran out in between.
    expect(second.signature).toBe(first.signature);
    expect(second.reasonHash).toBe(first.reasonHash);
    expect(second.evaluatedAt).toBe(first.evaluatedAt);

    const restored = await json<VerifyResponse>(await call(`/api/verify/${orderId}`));
    expect(restored.signature).toBe(first.signature);
  }, 60_000);

  it("reports the supply side so a buyer can see whether anyone can accept", async () => {
    const supply = await json<{count: number; activeCount: number; maxAvailableStake: string}>(
      await call("/api/operators")
    );
    expect(supply.count).toBeGreaterThan(0);
    expect(supply.activeCount).toBeGreaterThan(0);
    expect(BigInt(supply.maxAvailableStake)).toBeGreaterThan(0n);
  }, 60_000);

  it("indexes orders by address from logs rather than scanning the tail", async () => {
    const buyer = privateKeyToAccount(BUYER_PK).address;
    const mine = await json<{orders: {buyer: string}[]; returned: number}>(
      await call(`/api/orders?address=${buyer}`)
    );
    expect(mine.returned).toBeGreaterThan(0);
    expect(mine.orders.every((o) => o.buyer.toLowerCase() === buyer.toLowerCase())).toBe(true);

    const stranger = await json<{returned: number}>(
      await call("/api/orders?address=0x000000000000000000000000000000000000dEaD")
    );
    expect(stranger.returned).toBe(0);
  }, 60_000);

  it("publishes the transaction trail and the signed certificate on the proof bundle", async () => {
    const orderId = await orderThroughDelivery(
      ["Output must mention the duplicate charge refund"],
      "Refund issued for the duplicate charge."
    );
    const verdict = await json<VerifyResponse>(await call(`/api/verify/${orderId}`, {method: "POST", body: "{}"}));
    await settle(orderId, verdict);

    const proof = await json<{
      timeline: {event: string; txHash: string; explorer: string}[];
      settlementTx: string | null;
      certificate: {signature: string; digest: string} | null;
      hashChecks: {artifactUrl: string}[];
    }>(await call(`/api/proof/${orderId}`));

    expect(proof.timeline.map((t) => t.event)).toEqual(
      expect.arrayContaining(["OrderCreated", "OrderAccepted", "DeliverySubmitted", "AIVerdictSettled"])
    );
    expect(proof.timeline.every((t) => /^0x[0-9a-f]{64}$/i.test(t.txHash))).toBe(true);
    expect(proof.settlementTx).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(proof.certificate?.signature).toBe(verdict.signature);
    expect(proof.hashChecks.every((c) => c.artifactUrl.startsWith("/api/artifacts/0x"))).toBe(true);
  }, 60_000);

  it("previews a verdict with no order, no chain write and no signature", async () => {
    const res = await call("/api/preview", {
      method: "POST",
      body: JSON.stringify({
        jobSpec: {
          title: "t",
          taskType: "text-eval",
          instructions: "i",
          input: "x",
          rubric: ["Output must mention the duplicate charge refund"],
          modelId: MODEL_ID,
        },
        output: "The duplicate charge refund was processed.",
      }),
    });
    const preview = await json<{preview: boolean; verdict: string; signature?: string}>(res);
    expect(preview.preview).toBe(true);
    expect(["PASS", "FAIL"]).toContain(preview.verdict);
    expect(preview.signature).toBeUndefined();
  }, 60_000);

  it("rejects a preview with no rubric or no output", async () => {
    const res = await call("/api/preview", {method: "POST", body: JSON.stringify({jobSpec: {rubric: []}, output: ""})});
    expect(res.status).toBe(400);
  });

  it("refuses to judge when the published artifact is missing", async () => {
    const {hashText} = await import("@metrx/shared");
    const buyer = wallet(BUYER_PK);
    const operator = wallet(OPERATOR_PK);
    const now = Math.floor(Date.now() / 1000);

    await publicClient.waitForTransactionReceipt({
      hash: await buyer.writeContract({
        account: buyer.account,
        chain,
        address: core,
        abi: artifact.abi,
        functionName: "createOrder",
        args: [
          hashText("never-published-spec"),
          hashText("input"),
          hashText("rubric"),
          hashText(MODEL_ID),
          BigInt(now + 3600),
          BigInt(now + 7200),
          parseEther("0.1"),
        ],
        value: parseEther("0.2"),
      }),
    });
    const orderId = (await publicClient.readContract({
      address: core,
      abi: artifact.abi,
      functionName: "totalOrders",
    })) as bigint;

    for (const c of [
      {functionName: "acceptOrder", args: [orderId]},
      {functionName: "submitDelivery", args: [orderId, hashText("out"), hashText("missing-artifact")]},
    ]) {
      await publicClient.waitForTransactionReceipt({
        hash: await operator.writeContract({account: operator.account, chain, address: core, abi: artifact.abi, ...c} as never),
      });
    }

    const res = await call(`/api/verify/${orderId}`, {method: "POST", body: "{}"});
    expect(res.status).toBe(404);
    expect((await json<{error: string}>(res)).error).toBe("artifact_missing");
  }, 60_000);
});
