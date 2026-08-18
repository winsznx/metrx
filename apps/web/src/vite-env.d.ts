/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_BOT_RPC_URL?: string;
  readonly VITE_METRX_CORE_ADDRESS?: string;
  readonly VITE_AI_VERIFIER_ADDRESS?: string;
  readonly VITE_GITHUB_URL?: string;
  readonly VITE_DEMO_VIDEO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ethereum?: {
    isMetaMask?: boolean;
    request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
  };
}
