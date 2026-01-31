# spark-wallet

OpenClaw skill for managing Bitcoin wallets on [Spark](https://spark.info) (L2) with [Flashnet](https://flashnet.xyz) AMM trading.

## Features

- **Wallet Management** — Create, import, and manage multiple Spark wallets
- **Instant Transfers** — Send BTC and tokens on Spark (free, instant)
- **Lightning** — Create invoices, pay invoices, estimate fees
- **L1 Bridge** — Deposit from and withdraw to Bitcoin mainnet
- **Trading** — Swap tokens via Flashnet AMM with real-time pricing

## Install

```bash
openclaw skills install github:flashnetxyz/spark-wallet
```

Then install dependencies:
```bash
cd ~/.openclaw/skills/spark-wallet && npm install
```

## Quick Start

```bash
# Create a wallet
node scripts/spark-wallet.mjs create main

# Check balance
node scripts/spark-wallet.mjs balance

# Get deposit address
node scripts/spark-wallet.mjs address

# Send BTC on Spark (free, instant)
node scripts/spark-wallet.mjs send spark1abc... 10000

# Buy $5 worth of BTC with USDB
node scripts/spark-wallet.mjs buy 5 btc

# Swap 100 USDB for BTC
node scripts/spark-wallet.mjs swap usdb btc 100
```

## Commands

| Command | Description |
|---------|-------------|
| `create <name>` | Create new wallet |
| `list` | List all wallets |
| `balance` | Get BTC + token balances |
| `address` | Get Spark address + L1 deposit address |
| `send <addr> <sats>` | Send BTC on Spark |
| `send-tokens <addr> <token> <amount>` | Send tokens |
| `buy <$amount> <token>` | Buy token with USD amount |
| `swap <from> <to> <amount>` | Swap tokens |
| `ln-invoice <sats>` | Create Lightning invoice |
| `ln-pay <bolt11>` | Pay Lightning invoice |
| `l1-withdraw <addr> <sats>` | Withdraw to L1 |

## Environment

- `SPARK_NETWORK` — `MAINNET` (default) or `REGTEST`
- `SPARK_WALLETS_FILE` — Custom wallet storage path

## Links

- [Flashnet](https://flashnet.xyz) — Non-custodial Bitcoin exchange infrastructure
- [Spark](https://spark.info) — Bitcoin L2 by Lightspark
- [OpenClaw](https://openclaw.ai) — AI assistant framework

## License

MIT
