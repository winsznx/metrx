import {afterEach, describe, expect, it, vi} from "vitest";
import {hashText} from "@metrx/shared";
import {verify, type VerificationInput} from "../src/aiVerifier.js";
import type {Env} from "../src/env.js";

/**
 * The Groq provider is the one that signs real mainnet verdicts, so its failure modes matter
 * as much as its happy path. These stub the network to prove the request shape is right and,
 * more importantly, that every ambiguous response refuses to sign rather than guessing.
 */

const MODEL = "openai/gpt-oss-120b";

const envFor = (modelId = MODEL): Env => ({
  BOT_RPC_URL: "http://127.0.0.1:1",
  BOT_CHAIN_ID: "677",
  METRX_CORE_ADDRESS: "",
  AI_PROVIDER: "groq",
  AI_MODEL_ID: modelId,
  ALLOWED_ORIGIN: "*",
  GROQ_API_KEY: "gsk_test",
});

const inputFor = (modelId = MODEL): VerificationInput => ({
  orderId: "1",
  jobSpec: {
    title: "Summarize a ticket",
    taskType: "text-eval",
    instructions: "Summarize into three action items.",
    input: "Customer charged twice.",
    rubric: ["Exactly three action items", "Mentions the duplicate charge"],
    modelId,
  },
  rubric: ["Exactly three action items", "Mentions the duplicate charge"],
  output: "1) confirm 2) refund the duplicate charge 3) reply",
  jobSpecHash: hashText("spec"),
  inputHash: hashText("in"),
  rubricHash: hashText("rubric"),
  modelHash: hashText(modelId),
  outputHash: hashText("out"),
});

const goodBody = {
  verdict: "PASS",
  scoreBps: 10_000,
  reason: "Both rubric items are satisfied by the delivered output, which lists three action items.",
  rubricFindings: [
    {rubricIndex: 0, satisfied: true, note: "three items present"},
    {rubricIndex: 1, satisfied: true, note: "duplicate charge named"},
  ],
};

const completion = (content: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(content)}}]}), {
    status: 200,
    headers: {"content-type": "application/json", ...headers},
  });

afterEach(() => vi.unstubAllGlobals());

describe("groq verifier", () => {
  it("asks a gpt-oss model to enforce the verdict schema itself", async () => {
    const fetchSpy = vi.fn(async () => completion(goodBody));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verify(envFor(), inputFor());

    expect(result.verdict).toBe("PASS");
    expect(result.mocked).toBe(false);
    expect(result.provider).toBe("groq");

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(MODEL);
    expect(body.temperature).toBe(0);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties.verdict.enum).toEqual(["PASS", "FAIL"]);
    // Strict mode requires every property listed and no extras.
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
  });

  it("falls back to json_object on a model without strict schema support", async () => {
    const fetchSpy = vi.fn(async () => completion(goodBody));
    vi.stubGlobal("fetch", fetchSpy);

    await verify(envFor("llama-3.3-70b-versatile"), inputFor("llama-3.3-70b-versatile"));

    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.response_format).toEqual({type: "json_object"});
  });

  it("reports the provider quota left after a call", async () => {
    vi.stubGlobal("fetch", async () =>
      completion(goodBody, {"x-ratelimit-remaining-requests": "985", "x-ratelimit-remaining-tokens": "11500"})
    );

    const result = await verify(envFor(), inputFor());
    expect(result.rateLimit?.requestsRemaining).toBe("985");
    expect(result.rateLimit?.tokensRemaining).toBe("11500");
  });

  it("waits out a short rate limit and then succeeds", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return calls === 1
        ? new Response("rate limited", {status: 429, headers: {"retry-after": "1"}})
        : completion(goodBody);
    });

    const result = await verify(envFor(), inputFor());
    expect(calls).toBe(2);
    expect(result.verdict).toBe("PASS");
  }, 15_000);

  it("refuses to sign when the rate limit reset is too far out", async () => {
    vi.stubGlobal("fetch", async () => new Response("slow down", {status: 429, headers: {"retry-after": "600"}}));

    await expect(verify(envFor(), inputFor())).rejects.toMatchObject({code: "ai_rate_limited"});
  });

  it("refuses to sign on a malformed model response", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({choices: [{message: {content: "I think it looks fine honestly"}}]}), {status: 200})
    );

    await expect(verify(envFor(), inputFor())).rejects.toMatchObject({code: "ai_malformed"});
  });

  it("refuses to sign a PASS that contradicts its own rubric findings", async () => {
    vi.stubGlobal("fetch", async () =>
      completion({
        ...goodBody,
        rubricFindings: [
          {rubricIndex: 0, satisfied: true, note: "ok"},
          {rubricIndex: 1, satisfied: false, note: "never mentions the duplicate charge"},
        ],
      })
    );

    await expect(verify(envFor(), inputFor())).rejects.toMatchObject({code: "ai_inconsistent"});
  });

  it("refuses to sign a score outside the basis-point range", async () => {
    vi.stubGlobal("fetch", async () => completion({...goodBody, scoreBps: 12_000}));
    await expect(verify(envFor(), inputFor())).rejects.toMatchObject({code: "ai_malformed"});
  });

  it("refuses an order that committed a different verifier model", async () => {
    vi.stubGlobal("fetch", async () => completion(goodBody));
    const mismatched = {...inputFor(), modelHash: hashText("some-other-model")};
    await expect(verify(envFor(), mismatched)).rejects.toMatchObject({code: "model_mismatch"});
  });

  it("refuses to sign with no API key configured", async () => {
    vi.stubGlobal("fetch", async () => completion(goodBody));
    await expect(verify({...envFor(), GROQ_API_KEY: undefined}, inputFor())).rejects.toMatchObject({
      code: "ai_key_missing",
    });
  });
});
