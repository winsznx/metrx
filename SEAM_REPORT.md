# SEAM_REPORT.md

Live pre-broadcast check of every BOT Chain Mainnet assumption Metrx depends on.
Regenerate with `pnpm seam:check`.

- Generated: 2026-08-19T05:16:40.428Z
- RPC: `https://rpc.botchain.ai`
- Explorer API: `https://scan.botchain.ai/api`

| Check | Result | Detail |
| --- | --- | --- |
| rpc reachable | PASS | https://rpc.botchain.ai |
| chain id | PASS | 677 (expected 677) |
| latest block readable | PASS | #20177169 hash 0x8374535cb7805dac... |
| fee model | PASS | baseFeePerGas is 0 -> use legacy gas pricing |
| non-standard block fields | PASS | milliTimestamp -> use tolerant reads |
| gas price readable | PASS | 20 gwei |
| lifecycle cost estimate | PASS | deploy ~0.042000 BOT, full lifecycle ~0.014000 BOT |
| deployer balance | PASS | 0x6bf5265BbfB6AE51e1E3f91c1A1165767CA1c135 -> 0.053239 BOT |
| MetrxCore deployed | PASS | 0x8b607937eE86Bfc9de57F5d2F8E9d02F58415532 code 10739 bytes |
| explorer api reachable | PASS | https://scan.botchain.ai/api -> HTTP 200 |
| no USDT dependency | PASS | v1 escrow and stake are native BOT only |
| no paymaster dependency | PASS | all writes are plain EOA transactions |

## Chain facts observed

- Chain ID: `677`
- Latest block: `20177169`
- Gas price: `20000000000 wei` (20 gwei)
- Base fee: `0x0` — legacy gas pricing is used for every broadcast
- Deployer: `0x6bf5265BbfB6AE51e1E3f91c1A1165767CA1c135` holding `53238570400000000` wei

## Standing decisions this check backs

- Escrow and stake are native BOT. No USDT contract is read or written.
- No paymaster, bundler, or account abstraction path is on the critical path.
- Broadcasts use `--legacy` because the chain reports a zero base fee.
- Receipts are parsed tolerantly: BOT Chain returns extra block/receipt fields
  (for example `milliTimestamp`) that strict EVM clients reject.

All checks passed.
