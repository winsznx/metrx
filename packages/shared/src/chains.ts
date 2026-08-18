import {defineChain} from "viem";

export const BOT_CHAIN_ID = 677 as const;
export const BOT_RPC_URL = "https://rpc.botchain.ai";
export const BOT_EXPLORER_URL = "https://scan.botchain.ai";

/// BOT Chain Mainnet. The chain reports a zero base fee, so every write is sent as a
/// legacy (type 0) transaction — see SEAM_REPORT.md.
export const botChain = defineChain({
  id: BOT_CHAIN_ID,
  name: "BOT Chain Mainnet",
  nativeCurrency: {name: "BOT", symbol: "BOT", decimals: 18},
  rpcUrls: {default: {http: [BOT_RPC_URL]}},
  blockExplorers: {default: {name: "BOTScan", url: BOT_EXPLORER_URL}},
  testnet: false,
});

export const explorerTx = (hash: string) => `${BOT_EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (address: string) => `${BOT_EXPLORER_URL}/address/${address}`;
