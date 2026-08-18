# SEAM_REPORT.md

Live pre-broadcast check of every BOT Chain Mainnet assumption Metrx depends on.
Regenerate with `pnpm seam:check`.

- Generated: 2026-08-17T01:51:39.518Z
- RPC: `https://rpc.botchain.ai`
- Explorer API: `https://scan.botchain.ai/api`

| Check | Result | Detail |
| --- | --- | --- |
| rpc reachable | PASS | https://rpc.botchain.ai |
| chain id | PASS | 677 (expected 677) |
| latest block readable | PASS | #19930367 hash 0xb914bd8378b8d024... |
| fee model | PASS | baseFeePerGas is 0 -> use legacy gas pricing |
| non-standard block fields | PASS | milliTimestamp -> use tolerant reads |
| gas price readable | PASS | 20 gwei |
| lifecycle cost estimate | PASS | deploy ~0.042000 BOT, full lifecycle ~0.014000 BOT |
| deployer balance | PASS | 0x6bf5265BbfB6AE51e1E3f91c1A1165767CA1c135 -> 0.300000 BOT |
| MetrxCore deployed | FAIL | METRX_CORE_ADDRESS unset (expected before first deploy) |
| explorer api reachable | PASS | https://scan.botchain.ai/api -> HTTP 200 |
| no USDT dependency | PASS | v1 escrow and stake are native BOT only |
| no paymaster dependency | PASS | all writes are plain EOA transactions |

## Chain facts observed

- Chain ID: `677`
- Latest block: `19930368`
- Gas price: `20000000000 wei` (20 gwei)
- Base fee: `0x0` — legacy gas pricing is used for every broadcast
- Deployer: `0x6bf5265BbfB6AE51e1E3f91c1A1165767CA1c135` holding `300000000000000000` wei

## Standing decisions this check backs

- Escrow and stake are native BOT. No USDT contract is read or written.
- No paymaster, bundler, or account abstraction path is on the critical path.
- Broadcasts use `--legacy` because the chain reports a zero base fee.
- Receipts are parsed tolerantly: BOT Chain returns extra block/receipt fields
  (for example `milliTimestamp`) that strict EVM clients reject.

1 check(s) failed: MetrxCore deployed.
