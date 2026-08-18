import type {Address} from "viem";

/**
 * Live BOT Chain Mainnet deployment.
 *
 * Written by `pnpm abi:sync` after `pnpm contracts:deploy`. The zero address means
 * "not yet broadcast" and every surface must degrade to a read-only / pending state
 * rather than pretending a contract exists.
 */
export interface Deployment {
  chainId: number;
  metrxCore: Address;
  aiVerifier: Address;
  deployedAtBlock: number;
  deployTxHash: string;
  verifiedOnExplorer: boolean;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const DEPLOYMENT: Deployment = {
  chainId: 677,
  metrxCore: "0x868ee03536A046DcFa568BbaE29C1C3a9f85B018",
  aiVerifier: "0x10053A1406C7024Fd237fe4192BC15A0Bc018C8d",
  deployedAtBlock: 19930429,
  deployTxHash: "0x3eaf5811797a8b739e2897175fa4937c3de0df722370e5eede82dd7068f1b196",
  verifiedOnExplorer: false,
};

export const isDeployed = (d: Deployment = DEPLOYMENT) => d.metrxCore !== ZERO_ADDRESS;

/** Resolve the core address, letting a build-time env override win over the checked-in value. */
export function resolveCoreAddress(override?: string | null): Address | null {
  const candidate = (override && override.trim()) || (isDeployed() ? DEPLOYMENT.metrxCore : "");
  return /^0x[0-9a-fA-F]{40}$/.test(candidate) && candidate !== ZERO_ADDRESS ? (candidate as Address) : null;
}

export function resolveVerifierAddress(override?: string | null): Address | null {
  const candidate = (override && override.trim()) || DEPLOYMENT.aiVerifier;
  return /^0x[0-9a-fA-F]{40}$/.test(candidate) && candidate !== ZERO_ADDRESS ? (candidate as Address) : null;
}
