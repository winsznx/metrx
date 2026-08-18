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
  type WalletClient,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {AI_VERDICT_TYPES, aiVerdictDomain, hashJson, hashText, VERDICT_FAIL, VERDICT_PASS} from "@metrx/shared";

/**
 * Cross-language parity: the EIP-712 certificate this codebase signs in TypeScript must be
 * the exact digest MetrxCore recovers in Solidity. A drift in the domain, the type string,
 * or a single field order would silently make every mainnet settlement unspendable, and a
 * unit test on either side alone would not catch it.
 *
 * Runs the full lifecycle against a local anvil node using the compiled mainnet artifact.
 */

const PORT = 8549;
const RPC = `http://127.0.0.1:${PORT}`;

const anvilChain = defineChain({
  id: 31337,
  name: "anvil",
  nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
});

// Deterministic anvil accounts.
const DEPLOYER_PK = "0xac0971bd0d1b8e02b62bcb47b04e5b0dd0c0a3c1c8b3e2d3f6e7a8b9c0d1e2f3" as Hex;
const BUYER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const OPERATOR_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;
const VERIFIER_PK = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;

const artifact = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../contracts/out/MetrxCore.sol/MetrxCore.json", import.meta.url)), "utf8")
);

const JOB_SPEC = {
  title: "Summarize a support ticket",
  taskType: "text-eval" as const,
  instructions: "Summarize this ticket into exactly 3 action items.",
  input: "Customer was charged twice in October and wants a refund confirmed by Friday.",
  rubric: ["Output must contain exactly 3 action items", "Output must mention the duplicate charge"],
  modelId: "metrx-parity-model",
};

let anvil: ChildProcess;
let publicClient: PublicClient;
let core: Address;

const wallet = (pk: Hex): WalletClient =>
  createWalletClient({account: privateKeyToAccount(pk), chain: anvilChain, transport: http(RPC)});

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
      // node not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("anvil did not start");
}

beforeAll(async () => {
  anvil = spawn("anvil", ["--port", String(PORT), "--silent"], {stdio: "ignore"});
  await waitForRpc();

  publicClient = createPublicClient({chain: anvilChain, transport: http(RPC)}) as PublicClient;

  const deployer = wallet(DEPLOYER_PK);
  // anvil funds its own default accounts; top up the deployer key used here.
  const funder = wallet(BUYER_PK);
  await funder.sendTransaction({
    account: funder.account!,
    chain: anvilChain,
    to: deployer.account!.address,
    value: parseEther("100"),
  });

  const hash = await deployer.deployContract({
    account: deployer.account!,
    chain: anvilChain,
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
    args: [privateKeyToAccount(VERIFIER_PK).address],
  });
  const receipt = await publicClient.waitForTransactionReceipt({hash});
  core = receipt.contractAddress!;
}, 60_000);

afterAll(() => {
  anvil?.kill();
});

async function runLifecycle(output: string, verdict: "PASS" | "FAIL") {
  const buyer = wallet(BUYER_PK);
  const operator = wallet(OPERATOR_PK);
  const abi = artifact.abi;
  const now = Math.floor(Date.now() / 1000);

  const opProfile = (await publicClient.readContract({
    address: core,
    abi,
    functionName: "getOperator",
    args: [operator.account!.address],
  })) as {owner: Address};

  if (opProfile.owner === "0x0000000000000000000000000000000000000000") {
    const h = await operator.writeContract({
      account: operator.account!,
      chain: anvilChain,
      address: core,
      abi,
      functionName: "registerOperator",
      args: ["https://operator.example"],
      value: parseEther("5"),
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  }

  const createHash = await buyer.writeContract({
    account: buyer.account!,
    chain: anvilChain,
    address: core,
    abi,
    functionName: "createOrder",
    args: [
      hashJson(JOB_SPEC),
      hashText(JOB_SPEC.input),
      hashJson(JOB_SPEC.rubric),
      hashText(JOB_SPEC.modelId),
      BigInt(now + 3600),
      BigInt(now + 7200),
      parseEther("0.5"),
    ],
    value: parseEther("1"),
  });
  await publicClient.waitForTransactionReceipt({hash: createHash});

  const orderId = (await publicClient.readContract({address: core, abi, functionName: "totalOrders"})) as bigint;

  for (const call of [
    {functionName: "acceptOrder", args: [orderId]},
    {functionName: "submitDelivery", args: [orderId, hashText(output), hashJson({orderId: orderId.toString(), output})]},
  ]) {
    const h = await operator.writeContract({
      account: operator.account!,
      chain: anvilChain,
      address: core,
      abi,
      ...call,
    } as never);
    await publicClient.waitForTransactionReceipt({hash: h});
  }

  const order = (await publicClient.readContract({
    address: core,
    abi,
    functionName: "getOrder",
    args: [orderId],
  })) as Record<string, Hex | bigint>;

  const reasonArtifact = {
    orderId: orderId.toString(),
    verdict,
    scoreBps: verdict === "PASS" ? 10_000 : 5000,
    reason: "Parity test certificate produced by the shared TypeScript signer.",
    rubricFindings: [],
    modelId: JOB_SPEC.modelId,
    evaluatedAt: Number(order.deliveredAt as bigint),
  };
  const reasonHash = hashJson(reasonArtifact);
  const evaluatedAt = BigInt(reasonArtifact.evaluatedAt);

  const verifier = privateKeyToAccount(VERIFIER_PK);
  const signature = await verifier.signTypedData({
    domain: aiVerdictDomain(core, 31337),
    types: AI_VERDICT_TYPES,
    primaryType: "AIVerdict",
    message: {
      orderId,
      jobSpecHash: order.jobSpecHash as Hex,
      inputHash: order.inputHash as Hex,
      rubricHash: order.rubricHash as Hex,
      modelHash: order.modelHash as Hex,
      outputHash: order.outputHash as Hex,
      verdict: verdict === "PASS" ? VERDICT_PASS : VERDICT_FAIL,
      scoreBps: reasonArtifact.scoreBps,
      reasonHash,
      evaluatedAt,
    },
  });

  return {orderId, order, reasonHash, evaluatedAt, signature, scoreBps: reasonArtifact.scoreBps};
}

describe("EIP-712 parity against the deployed bytecode", () => {
  it("the contract rebuilds the same digest the TypeScript signer produced", async () => {
    const {orderId, reasonHash, evaluatedAt, signature} = await runLifecycle("three action items, duplicate charge", "PASS");

    const onChainDigest = (await publicClient.readContract({
      address: core,
      abi: artifact.abi,
      functionName: "aiVerdictDigest",
      args: [orderId, VERDICT_PASS, 10_000, reasonHash, evaluatedAt],
    })) as Hex;

    const recovered = await publicClient.verifyTypedData({
      address: privateKeyToAccount(VERIFIER_PK).address,
      domain: aiVerdictDomain(core, 31337),
      types: AI_VERDICT_TYPES,
      primaryType: "AIVerdict",
      message: {
        orderId,
        jobSpecHash: hashJson(JOB_SPEC),
        inputHash: hashText(JOB_SPEC.input),
        rubricHash: hashJson(JOB_SPEC.rubric),
        modelHash: hashText(JOB_SPEC.modelId),
        outputHash: hashText("three action items, duplicate charge"),
        verdict: VERDICT_PASS,
        scoreBps: 10_000,
        reasonHash,
        evaluatedAt,
      },
      signature,
    });

    expect(onChainDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(recovered).toBe(true);
  }, 60_000);

  it("a PASS certificate settles and pays the operator", async () => {
    const {orderId, order, reasonHash, evaluatedAt, signature, scoreBps} = await runLifecycle(
      "pass path: three action items about the duplicate charge",
      "PASS"
    );

    const operatorAddress = privateKeyToAccount(OPERATOR_PK).address;
    const before = await publicClient.getBalance({address: operatorAddress});

    const submitter = wallet(DEPLOYER_PK);
    const hash = await submitter.writeContract({
      account: submitter.account!,
      chain: anvilChain,
      address: core,
      abi: artifact.abi,
      functionName: "settleWithAIVerdict",
      args: [orderId, VERDICT_PASS, scoreBps, reasonHash, evaluatedAt, signature],
    });
    const receipt = await publicClient.waitForTransactionReceipt({hash});
    expect(receipt.status).toBe("success");

    const settled = (await publicClient.readContract({
      address: core,
      abi: artifact.abi,
      functionName: "getOrder",
      args: [orderId],
    })) as Record<string, number | bigint>;

    expect(Number(settled.status)).toBe(4); // Paid
    expect(await publicClient.getBalance({address: operatorAddress})).toBe(before + (order.price as bigint));
  }, 60_000);

  it("a FAIL certificate refunds the buyer and slashes the operator", async () => {
    const {orderId, order, reasonHash, evaluatedAt, signature, scoreBps} = await runLifecycle(
      "fail path: unrelated text",
      "FAIL"
    );

    const buyerAddress = privateKeyToAccount(BUYER_PK).address;
    const before = await publicClient.getBalance({address: buyerAddress});

    const submitter = wallet(DEPLOYER_PK);
    const hash = await submitter.writeContract({
      account: submitter.account!,
      chain: anvilChain,
      address: core,
      abi: artifact.abi,
      functionName: "settleWithAIVerdict",
      args: [orderId, VERDICT_FAIL, scoreBps, reasonHash, evaluatedAt, signature],
    });
    await publicClient.waitForTransactionReceipt({hash});

    const settled = (await publicClient.readContract({
      address: core,
      abi: artifact.abi,
      functionName: "getOrder",
      args: [orderId],
    })) as Record<string, number | bigint>;

    expect(Number(settled.status)).toBe(6); // Slashed
    expect(await publicClient.getBalance({address: buyerAddress})).toBe(
      before + (order.price as bigint) + (order.maxSlash as bigint)
    );
  }, 60_000);

  it("a certificate signed by any other key is rejected on chain", async () => {
    const {orderId, reasonHash, evaluatedAt, scoreBps} = await runLifecycle("impostor path", "PASS");

    const impostor = privateKeyToAccount(OPERATOR_PK);
    const forged = await impostor.signTypedData({
      domain: aiVerdictDomain(core, 31337),
      types: AI_VERDICT_TYPES,
      primaryType: "AIVerdict",
      message: {
        orderId,
        jobSpecHash: hashJson(JOB_SPEC),
        inputHash: hashText(JOB_SPEC.input),
        rubricHash: hashJson(JOB_SPEC.rubric),
        modelHash: hashText(JOB_SPEC.modelId),
        outputHash: hashText("impostor path"),
        verdict: VERDICT_PASS,
        scoreBps,
        reasonHash,
        evaluatedAt,
      },
    });

    const submitter = wallet(DEPLOYER_PK);
    await expect(
      submitter.writeContract({
        account: submitter.account!,
        chain: anvilChain,
        address: core,
        abi: artifact.abi,
        functionName: "settleWithAIVerdict",
        args: [orderId, VERDICT_PASS, scoreBps, reasonHash, evaluatedAt, forged],
      })
    ).rejects.toThrow();
  }, 60_000);
});
