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
  metrxCore: "0x8b607937eE86Bfc9de57F5d2F8E9d02F58415532",
  aiVerifier: "0x10053A1406C7024Fd237fe4192BC15A0Bc018C8d",
  deployedAtBlock: 20153854,
  deployTxHash: "0x9cb0c561e32601a3b2de2a976b25c92966945b59706daefcaf37064319ba38ee",
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
