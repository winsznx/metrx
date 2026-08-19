import type {Hex} from "viem";
import {hashJson, hashText, type JobSpec, type VerifierReason} from "@metrx/shared";
import {badRequest, misconfigured, rateLimited, type Env} from "./env.js";

/**
 * The AI verifier.
 *
 * It is a settlement participant, not a chat surface: it reads the job spec, the buyer's
 * rubric and the operator's delivered output, and returns a structured verdict that is
 * then signed as an EIP-712 certificate. A malformed model response is a hard failure —
 * the verifier refuses to settle rather than guessing an outcome.
 */

export interface VerificationInput {
  orderId: string;
  jobSpec: JobSpec;
  rubric: string[];
  inputSummary?: string;
  output: string;
  jobSpecHash: Hex;
  inputHash: Hex;
  rubricHash: Hex;
  modelHash: Hex;
  outputHash: Hex;
}

export interface VerificationResult {
  verdict: "PASS" | "FAIL";
  scoreBps: number;
  reason: string;
  reasonHash: Hex;
  modelId: string;
  modelHash: Hex;
  rubricFindings: {rubricIndex: number; satisfied: boolean; note: string}[];
  /** The exact object `reasonHash` commits to. Stored verbatim so anyone can recompute the hash. */
  reasonArtifact: VerifierReason;
  provider: string;
  mocked: boolean;
  /** Provider quota left after this call, when the provider reports it. */
  rateLimit: RateLimitSnapshot | null;
}

export type Provider = "groq" | "anthropic" | "openai" | "workers-ai" | "mock";

const PROVIDERS = ["groq", "anthropic", "openai", "workers-ai", "mock"] as const;

export const resolveProvider = (env: Env): Provider => {
  const raw = (env.AI_PROVIDER || "mock").toLowerCase();
  return PROVIDERS.includes(raw as Provider) ? (raw as Provider) : "mock";
};

export const modelIdOf = (env: Env) => (env.AI_MODEL_ID || "metrx-mock-verifier-v1").trim();
export const modelHashOf = (env: Env): Hex => hashText(modelIdOf(env));

/** What the provider told us about remaining quota, surfaced so the product can pace itself. */
export interface RateLimitSnapshot {
  requestsRemaining: string | null;
  tokensRemaining: string | null;
  requestsReset: string | null;
  tokensReset: string | null;
}

interface ModelResponse {
  text: string;
  rateLimit: RateLimitSnapshot | null;
}

const readRateLimit = (headers: Headers): RateLimitSnapshot => ({
  requestsRemaining: headers.get("x-ratelimit-remaining-requests"),
  tokensRemaining: headers.get("x-ratelimit-remaining-tokens"),
  requestsReset: headers.get("x-ratelimit-reset-requests"),
  tokensReset: headers.get("x-ratelimit-reset-tokens"),
});

const SYSTEM_PROMPT = `You are the Metrx settlement verifier. You decide whether an operator's delivered output satisfies a buyer's published rubric for a paid compute job. Your verdict is enforced on-chain: PASS pays the operator, FAIL refunds the buyer and slashes the operator's stake.

Rules you must follow:
- Judge only against the rubric items given. Do not invent additional requirements.
- Judge the output as delivered. Do not rewrite or improve it.
- Every rubric item must be evaluated independently.
- PASS requires every rubric item to be satisfied. If any item fails, the verdict is FAIL.
- scoreBps is the share of rubric items satisfied, in basis points of 10000.
- Your reason must cite the specific rubric items and quote the evidence from the output.
- Be strict. A plausible-sounding but non-compliant output is a FAIL.

Return exactly one JSON object and nothing else:
{"verdict":"PASS"|"FAIL","scoreBps":<integer 0-10000>,"reason":"<2-5 sentences>","rubricFindings":[{"rubricIndex":<0-based>,"satisfied":true|false,"note":"<short>"}]}`;

function userPrompt(input: VerificationInput): string {
  const rubric = input.rubric.map((r, i) => `  [${i}] ${r}`).join("\n");
  return `JOB TITLE
${input.jobSpec.title}

INSTRUCTIONS GIVEN TO THE OPERATOR
${input.jobSpec.instructions}

JOB INPUT
${input.jobSpec.input}

RUBRIC (evaluate every item)
${rubric}

OPERATOR'S DELIVERED OUTPUT
<<<OUTPUT
${input.output}
OUTPUT

Return the JSON verdict now.`;
}

interface RawVerdict {
  verdict: "PASS" | "FAIL";
  scoreBps: number;
  reason: string;
  rubricFindings?: {rubricIndex: number; satisfied: boolean; note: string}[];
}

/** Models sometimes wrap JSON in prose or a code fence. Extract the first balanced object. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  if (start === -1) throw badRequest("ai_malformed", "The verifier model returned no JSON object.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) {
      return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw badRequest("ai_malformed", "The verifier model returned an unterminated JSON object.");
}

function validate(raw: unknown, rubricLength: number): RawVerdict {
  if (typeof raw !== "object" || raw === null) throw badRequest("ai_malformed", "Verifier response was not an object.");
  const v = raw as Record<string, unknown>;

  if (v.verdict !== "PASS" && v.verdict !== "FAIL") {
    throw badRequest("ai_malformed", `Verifier returned an unusable verdict: ${JSON.stringify(v.verdict)}.`);
  }
  const score = Number(v.scoreBps);
  if (!Number.isInteger(score) || score < 0 || score > 10_000) {
    throw badRequest("ai_malformed", `Verifier returned a score outside 0-10000: ${JSON.stringify(v.scoreBps)}.`);
  }
  if (typeof v.reason !== "string" || v.reason.trim().length < 20) {
    throw badRequest("ai_malformed", "Verifier returned no usable reason. Refusing to settle.");
  }

  const findings = Array.isArray(v.rubricFindings)
    ? (v.rubricFindings as {rubricIndex: number; satisfied: boolean; note: string}[]).filter(
        (f) => Number.isInteger(f?.rubricIndex) && f.rubricIndex >= 0 && f.rubricIndex < rubricLength
      )
    : [];

  // The contract cannot check this, so the verifier enforces it before signing:
  // a PASS with a failed rubric finding is internally inconsistent and must not settle.
  if (v.verdict === "PASS" && findings.some((f) => f.satisfied === false)) {
    throw badRequest("ai_inconsistent", "Verifier returned PASS while marking a rubric item unsatisfied.");
  }

  return {verdict: v.verdict, scoreBps: score, reason: v.reason.trim(), rubricFindings: findings};
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * Groq's OpenAI-compatible chat completions endpoint.
 *
 * The `openai/gpt-oss-*` models support strict `json_schema` structured outputs, which is
 * why they are the default: schema enforcement removes the malformed-response failure mode
 * at the source rather than making the verifier recover from it. Any other model falls back
 * to `json_object`, and the validator still refuses to sign anything it cannot trust.
 */
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const supportsStrictSchema = (modelId: string) => /^openai\/gpt-oss-/.test(modelId);

const VERDICT_JSON_SCHEMA = {
  name: "metrx_verdict",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "scoreBps", "reason", "rubricFindings"],
    properties: {
      verdict: {type: "string", enum: ["PASS", "FAIL"]},
      scoreBps: {type: "integer", minimum: 0, maximum: 10_000},
      reason: {type: "string"},
      rubricFindings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["rubricIndex", "satisfied", "note"],
          properties: {
            rubricIndex: {type: "integer"},
            satisfied: {type: "boolean"},
            note: {type: "string"},
          },
        },
      },
    },
  },
} as const;

/** Groq returns 429 with `retry-after` in seconds. Wait it out once or twice, then give up honestly. */
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RETRY_WAIT_SECONDS = 20;

async function callGroq(env: Env, input: VerificationInput): Promise<ModelResponse> {
  if (!env.GROQ_API_KEY) throw misconfigured("ai_key_missing", "GROQ_API_KEY is not set on this worker.");
  const modelId = modelIdOf(env);

  const body = {
    model: modelId,
    temperature: 0,
    max_completion_tokens: 1200,
    response_format: supportsStrictSchema(modelId)
      ? {type: "json_schema", json_schema: VERDICT_JSON_SCHEMA}
      : {type: "json_object"},
    messages: [
      {role: "system", content: SYSTEM_PROMPT},
      {role: "user", content: userPrompt(input)},
    ],
  };

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {"content-type": "application/json", authorization: `Bearer ${env.GROQ_API_KEY}`},
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "0");
      if (attempt >= MAX_RATE_LIMIT_RETRIES || !Number.isFinite(wait) || wait > MAX_RETRY_WAIT_SECONDS) {
        throw rateLimited(
          `Groq rate limit reached for ${modelId}. ${
            wait ? `Quota resets in about ${Math.ceil(wait)}s.` : "Try again shortly."
          } Nothing was signed.`
        );
      }
      await new Promise((r) => setTimeout(r, Math.max(1, wait) * 1000));
      continue;
    }

    if (!res.ok) throw badRequest("ai_upstream", `Groq returned HTTP ${res.status}: ${await res.text()}`);

    const payload = (await res.json()) as {choices?: {message?: {content?: string}}[]};
    return {text: payload.choices?.[0]?.message?.content ?? "", rateLimit: readRateLimit(res.headers)};
  }
}

async function callAnthropic(env: Env, input: VerificationInput): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) throw misconfigured("ai_key_missing", "ANTHROPIC_API_KEY is not set on this worker.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelIdOf(env),
      max_tokens: 1200,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{role: "user", content: userPrompt(input)}],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw badRequest("ai_upstream", `Anthropic returned HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as {content: {type: string; text?: string}[]};
  return body.content.map((c) => c.text ?? "").join("");
}

async function callOpenAI(env: Env, input: VerificationInput): Promise<string> {
  if (!env.OPENAI_API_KEY) throw misconfigured("ai_key_missing", "OPENAI_API_KEY is not set on this worker.");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {"content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}`},
    body: JSON.stringify({
      model: modelIdOf(env),
      temperature: 0,
      response_format: {type: "json_object"},
      messages: [
        {role: "system", content: SYSTEM_PROMPT},
        {role: "user", content: userPrompt(input)},
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw badRequest("ai_upstream", `OpenAI returned HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as {choices: {message: {content: string}}[]};
  return body.choices[0]?.message.content ?? "";
}

async function callWorkersAI(env: Env, input: VerificationInput): Promise<string> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    throw misconfigured("ai_key_missing", "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set.");
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${modelIdOf(env)}`,
    {
      method: "POST",
      headers: {"content-type": "application/json", authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`},
      body: JSON.stringify({
        temperature: 0,
        messages: [
          {role: "system", content: SYSTEM_PROMPT},
          {role: "user", content: userPrompt(input)},
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    }
  );
  if (!res.ok) throw badRequest("ai_upstream", `Workers AI returned HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as {result?: {response?: string}};
  return body.result?.response ?? "";
}

/**
 * Deterministic local stand-in used only when `AI_PROVIDER=mock`.
 * It applies a crude keyword check per rubric item so the full lifecycle can be
 * exercised offline. Every response it produces is tagged `mocked: true` and every
 * surface that renders a mocked verdict says so.
 */
function runMock(input: VerificationInput): RawVerdict {
  const haystack = input.output.toLowerCase();
  const findings = input.rubric.map((item, rubricIndex) => {
    const terms = item
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4 && !["output", "should", "contain", "mention", "would", "there"].includes(w));
    const hits = terms.filter((t) => haystack.includes(t)).length;
    const satisfied = terms.length === 0 ? true : hits / terms.length >= 0.5;
    return {
      rubricIndex,
      satisfied,
      note: satisfied ? `matched ${hits}/${terms.length} key terms` : `matched only ${hits}/${terms.length} key terms`,
    };
  });
  const satisfiedCount = findings.filter((f) => f.satisfied).length;
  const scoreBps = findings.length === 0 ? 10_000 : Math.round((satisfiedCount / findings.length) * 10_000);
  return {
    verdict: satisfiedCount === findings.length ? "PASS" : "FAIL",
    scoreBps,
    reason: `Deterministic mock verifier: ${satisfiedCount} of ${findings.length} rubric items satisfied by keyword coverage of the delivered output. This is a local stand-in, not a model judgement.`,
    rubricFindings: findings,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function verify(
  env: Env,
  input: VerificationInput,
  /** Chain-side floor for the certificate timestamp; the contract rejects a verdict dated before delivery. */
  notBefore = 0
): Promise<VerificationResult> {
  const provider = resolveProvider(env);
  const modelId = modelIdOf(env);

  // The buyer committed a model hash at order creation. This verifier may only judge
  // orders that named the model it actually runs.
  const modelHash = hashText(modelId);
  if (modelHash.toLowerCase() !== input.modelHash.toLowerCase()) {
    throw badRequest(
      "model_mismatch",
      `This order was created for a different verifier model. On-chain modelHash ${input.modelHash} does not match this worker's model "${modelId}".`
    );
  }

  let raw: RawVerdict;
  let rateLimit: RateLimitSnapshot | null = null;

  if (provider === "mock") {
    raw = runMock(input);
  } else {
    let text: string;
    if (provider === "groq") {
      const response = await callGroq(env, input);
      text = response.text;
      rateLimit = response.rateLimit;
    } else if (provider === "anthropic") {
      text = await callAnthropic(env, input);
    } else if (provider === "openai") {
      text = await callOpenAI(env, input);
    } else {
      text = await callWorkersAI(env, input);
    }
    raw = validate(extractJson(text), input.rubric.length);
  }

  const reasonArtifact: VerifierReason = {
    orderId: input.orderId,
    verdict: raw.verdict,
    scoreBps: raw.scoreBps,
    reason: raw.reason,
    rubricFindings: raw.rubricFindings ?? [],
    modelId,
    evaluatedAt: Math.max(Math.floor(Date.now() / 1000), notBefore),
    provider,
    mocked: provider === "mock",
  };

  return {
    verdict: raw.verdict,
    scoreBps: raw.scoreBps,
    reason: raw.reason,
    reasonHash: hashJson(reasonArtifact),
    modelId,
    modelHash,
    rubricFindings: reasonArtifact.rubricFindings,
    reasonArtifact,
    provider,
    mocked: provider === "mock",
    rateLimit,
  };
}

export {type VerifierReason};
