---
name: spark-wallet
description: Manage Bitcoin wallets on Spark (L2) with Flashnet AMM trading. Send/receive BTC and tokens instantly on Spark, bridge to/from Lightning and L1, buy/sell tokens via Flashnet. Use when the user wants to check wallet balance, send Bitcoin, receive payments, withdraw to L1, trade tokens, or manage Spark wallets.
metadata: {"openclaw":{"requires":{"bins":["node"],"env":["SPARK_NETWORK"]},"primaryEnv":"SPARK_NETWORK"}}
---

# Spark Wallet + Flashnet Trading

Manage Bitcoin wallets on Spark with trading via Flashnet AMM.

## Quick Reference

```bash
cd {baseDir} && node scripts/spark-wallet.mjs <command> [args]
```

## Wallet Management
| Command | Description |
|---------|-------------|
| `create <name> [mnemonic]` | Create new wallet or import existing |
| `list` | List all wallets |
| `use <name>` | Set default wallet |
| `balance [wallet]` | Get BTC + token balances |
| `address [wallet]` | Get Spark address + L1 deposit address |

## Trading (Flashnet AMM)

### Buy tokens with USD amount
```bash
# Buy $5 worth of BTC, paying with USDB
node scripts/spark-wallet.mjs buy 5 btc

# Buy $10 worth of a token, paying with BTC
node scripts/spark-wallet.mjs buy 10 btkn16w9v5shwtv78... btc
```

### Swap tokens
```bash
# Get quote first
node scripts/spark-wallet.mjs swap-quote usdb btc 5

# Execute swap (5 USDB -> BTC, 1% slippage)
node scripts/spark-wallet.mjs swap usdb btc 5

# With custom slippage (50 = 0.5%)
node scripts/spark-wallet.mjs swap usdb btc 5 50
```

### List pools
```bash
node scripts/spark-wallet.mjs pools
```

### Check BTC price
```bash
node scripts/spark-wallet.mjs price
```

## Sending (Free & Instant on Spark)
| Command | Description |
|---------|-------------|
| `send <spark_addr> <sats> [wallet]` | Send BTC to Spark address |
| `send-tokens <spark_addr> <token_id> <amount> [wallet]` | Send tokens |

## Lightning
| Command | Description |
|---------|-------------|
| `ln-invoice <sats> [memo] [wallet]` | Create BOLT11 invoice to receive |
| `ln-pay <bolt11> [max_fee] [wallet]` | Pay Lightning invoice |
| `ln-fee <bolt11> [wallet]` | Estimate payment fee |

## L1 (On-chain)
| Command | Description |
|---------|-------------|
| `l1-withdraw <btc_addr> <sats> [speed] [wallet]` | Withdraw to L1 |
| `l1-withdraw-quote <btc_addr> <sats> [wallet]` | Get fee quote first |
| `check-deposits` | Check mempool for pending deposits |
| `claim-deposit <txid> [wallet]` | Claim confirmed L1 deposit |

## Token Reference

**Known tokens:**
- **BTC**: `020202020202020202020202020202020202020202020202020202020202020202`
- **USDB**: `btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87`

For trading, you can use short names: `btc`, `usdb`, or full token IDs.

## Decimal Handling

Flashnet uses raw amounts (no decimals):
- **BTC**: 8 decimals → 1 BTC = 100,000,000 sats
- **USDB**: 6 decimals → $1 USDB = 1,000,000 units

The `buy` command handles USD→token conversion automatically using live BTC price from Kraken.

## Example Flows

### Buy $5 of BTC
```bash
node scripts/spark-wallet.mjs buy 5 btc
# Fetches BTC price, calculates USDB needed, executes swap
```

### Swap 100 USDB for BTC
```bash
node scripts/spark-wallet.mjs swap usdb btc 100
```

### Check balance after trading
```bash
node scripts/spark-wallet.mjs balance
```

## Multi-Wallet Support

All commands accept optional `[wallet]` parameter:
```bash
node scripts/spark-wallet.mjs buy 5 btc main
node scripts/spark-wallet.mjs balance trading
```

## Heartbeat: Auto-Check Deposits

Add to HEARTBEAT.md:
```bash
cd /root/clawd/skills/spark-wallet && node scripts/spark-wallet.mjs check-deposits
```

## Wallet Storage

Wallets stored in `{baseDir}/wallets.json`. Contains mnemonics - keep secure!

Override location: `SPARK_WALLETS_FILE=/path/to/wallets.json`

Network: `SPARK_NETWORK=MAINNET` (default) or `REGTEST`
