import {createConfig, http} from "wagmi";
import {injected} from "wagmi/connectors";
import {botChain} from "@metrx/shared";
import {RPC_URL} from "./config";

/**
 * Injected wallets only.
 *
 * WalletConnect is deliberately out of v1: it adds a relay dependency and a project id
 * to a flow whose whole point is that nothing sits between the user and BOT Chain.
 */
export const wagmiConfig = createConfig({
  chains: [botChain],
  connectors: [injected({shimDisconnect: true})],
  transports: {
    [botChain.id]: http(RPC_URL, {timeout: 20_000, retryCount: 2}),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
