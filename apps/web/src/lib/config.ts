import {botChain, resolveCoreAddress, resolveVerifierAddress, BOT_CHAIN_ID} from "@metrx/shared";

const env = import.meta.env;

export const API_BASE = (env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
export const RPC_URL = env.VITE_BOT_RPC_URL ?? botChain.rpcUrls.default.http[0];

/** Null until MetrxCore has actually been broadcast. Every surface degrades rather than faking it. */
export const CORE_ADDRESS = resolveCoreAddress(env.VITE_METRX_CORE_ADDRESS);
export const VERIFIER_ADDRESS = resolveVerifierAddress(env.VITE_AI_VERIFIER_ADDRESS);

export const CHAIN_ID = BOT_CHAIN_ID;
/** Empty until the repository is published. Every surface hides the link rather than shipping a 404. */
export const GITHUB_URL = env.VITE_GITHUB_URL ?? "";
export const DEMO_VIDEO_URL = env.VITE_DEMO_VIDEO_URL ?? "";

export const isLive = CORE_ADDRESS !== null;
