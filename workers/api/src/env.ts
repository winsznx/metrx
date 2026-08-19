export interface Env {
  // vars
  BOT_RPC_URL: string;
  BOT_CHAIN_ID: string;
  METRX_CORE_ADDRESS: string;
  /** Block MetrxCore was deployed at. Bounds the log scan that rebuilds order timelines. */
  METRX_DEPLOY_BLOCK?: string;
  AI_PROVIDER: string;
  AI_MODEL_ID: string;
  ALLOWED_ORIGIN: string;

  // secrets
  AI_VERIFIER_PRIVATE_KEY?: string;
  GROQ_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;

  // bindings (optional — the store degrades gracefully, see artifacts.ts)
  ARTIFACTS?: KVNamespace;
  ARTIFACTS_R2?: R2Bucket;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new ApiError(400, code, message);
export const notFound = (code: string, message: string) => new ApiError(404, code, message);
export const misconfigured = (code: string, message: string) => new ApiError(503, code, message);
export const rateLimited = (message: string) => new ApiError(429, "ai_rate_limited", message);
