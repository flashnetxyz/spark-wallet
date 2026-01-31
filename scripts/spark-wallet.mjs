#!/usr/bin/env node
/**
 * Spark Wallet CLI - Multi-wallet Bitcoin L1/Lightning/Spark management + Flashnet AMM
 * Usage: node spark-wallet.mjs <command> [options]
 */

import { SparkWallet } from '@buildonspark/spark-sdk';
import { FlashnetClient } from '@flashnet/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WALLETS_FILE = process.env.SPARK_WALLETS_FILE || path.join(__dirname, '..', 'wallets.json');
const NETWORK = process.env.SPARK_NETWORK || 'MAINNET';

// Known assets - use hex format for Flashnet AMM
const BTC_ASSET_ID = '020202020202020202020202020202020202020202020202020202020202020202';
const USDB_ASSET_ID = '3206c93b24a4d18ea19d0a9a213204af2c7e74a6d16c7535cc5d33eca4ad1eca';
const USDB_TOKEN_ID = 'btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87';

// Token registry with decimals
const TOKEN_REGISTRY = {
  'btc': { assetId: BTC_ASSET_ID, decimals: 8, ticker: 'BTC' },
  'sats': { assetId: BTC_ASSET_ID, decimals: 8, ticker: 'BTC' },
  'usdb': { assetId: USDB_ASSET_ID, decimals: 6, ticker: 'USDB', tokenId: USDB_TOKEN_ID },
  [BTC_ASSET_ID]: { assetId: BTC_ASSET_ID, decimals: 8, ticker: 'BTC' },
  [USDB_ASSET_ID]: { assetId: USDB_ASSET_ID, decimals: 6, ticker: 'USDB', tokenId: USDB_TOKEN_ID },
  [USDB_TOKEN_ID]: { assetId: USDB_ASSET_ID, decimals: 6, ticker: 'USDB', tokenId: USDB_TOKEN_ID },
};

// Wallet storage helpers
function loadWallets() {
  try {
    if (fs.existsSync(WALLETS_FILE)) {
      return JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));
    }
  } catch (e) {}
  return { wallets: {}, default: null };
}

function saveWallets(data) {
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(data, null, 2));
}

function getWalletConfig(name) {
  const data = loadWallets();
  const walletName = name || data.default;
  if (!walletName || !data.wallets[walletName]) {
    throw new Error(`Wallet "${walletName || 'default'}" not found. Run: spark-wallet create <name>`);
  }
  return { name: walletName, ...data.wallets[walletName] };
}

async function initWallet(name) {
  const config = getWalletConfig(name);
  const { wallet } = await SparkWallet.initialize({
    mnemonicOrSeed: config.mnemonic,
    accountNumber: config.accountNumber || (NETWORK === 'MAINNET' ? 1 : 0),
    options: { network: NETWORK }
  });
  return { wallet, config };
}

async function initFlashnetClient(name) {
  const { wallet, config } = await initWallet(name);
  const client = new FlashnetClient(wallet);
  await client.initialize();
  return { client, wallet, config };
}

// Get BTC price from Kraken (no API key needed)
async function getBtcPrice() {
  try {
    const response = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD');
    const data = await response.json();
    const price = parseFloat(data.result.XXBTZUSD.c[0]);
    return price;
  } catch (e) {
    // Fallback to CoinGecko
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    const data = await response.json();
    return data.bitcoin.usd;
  }
}

// Resolve token by name, ticker, or full ID
function resolveToken(tokenRef) {
  const lower = tokenRef.toLowerCase();
  if (TOKEN_REGISTRY[lower]) {
    return TOKEN_REGISTRY[lower];
  }
  if (TOKEN_REGISTRY[tokenRef]) {
    return TOKEN_REGISTRY[tokenRef];
  }
  // Unknown token - assume 0 decimals (raw)
  return { assetId: tokenRef, decimals: 0, ticker: tokenRef.substring(0, 8) + '...' };
}

// Convert human amount to raw (no decimals) for Flashnet
function toRawAmount(amount, decimals) {
  return BigInt(Math.floor(amount * Math.pow(10, decimals)));
}

// Convert raw amount to human readable
function fromRawAmount(rawAmount, decimals) {
  return Number(rawAmount) / Math.pow(10, decimals);
}

// Commands
const commands = {
  // Wallet Management
  async create(args) {
    const name = args[0];
    if (!name) throw new Error('Usage: spark-wallet create <name> [mnemonic]');
    
    const data = loadWallets();
    if (data.wallets[name]) throw new Error(`Wallet "${name}" already exists`);
    
    const existingMnemonic = args.slice(1).join(' ').trim() || undefined;
    const { wallet, mnemonic } = await SparkWallet.initialize({
      mnemonicOrSeed: existingMnemonic,
      accountNumber: NETWORK === 'MAINNET' ? 1 : 0,
      options: { network: NETWORK }
    });
    
    const sparkAddress = await wallet.getSparkAddress();
    const staticDepositAddress = await wallet.getStaticDepositAddress();
    
    data.wallets[name] = {
      mnemonic: existingMnemonic || mnemonic,
      sparkAddress,
      staticDepositAddress,
      createdAt: new Date().toISOString()
    };
    if (!data.default) data.default = name;
    saveWallets(data);
    
    await wallet.cleanupConnections();
    
    return {
      name,
      sparkAddress,
      staticDepositAddress,
      mnemonic: existingMnemonic ? '(imported)' : mnemonic,
      note: existingMnemonic ? 'Wallet imported' : 'SAVE THIS MNEMONIC SECURELY!'
    };
  },

  async list() {
    const data = loadWallets();
    const wallets = Object.entries(data.wallets).map(([name, w]) => ({
      name,
      sparkAddress: w.sparkAddress,
      staticDepositAddress: w.staticDepositAddress,
      isDefault: name === data.default
    }));
    return { wallets, default: data.default };
  },

  async use(args) {
    const name = args[0];
    if (!name) throw new Error('Usage: spark-wallet use <name>');
    
    const data = loadWallets();
    if (!data.wallets[name]) throw new Error(`Wallet "${name}" not found`);
    
    data.default = name;
    saveWallets(data);
    return { default: name, message: `Default wallet set to "${name}"` };
  },

  async delete(args) {
    const name = args[0];
    if (!name) throw new Error('Usage: spark-wallet delete <name>');
    
    const data = loadWallets();
    if (!data.wallets[name]) throw new Error(`Wallet "${name}" not found`);
    
    delete data.wallets[name];
    if (data.default === name) {
      data.default = Object.keys(data.wallets)[0] || null;
    }
    saveWallets(data);
    return { deleted: name, newDefault: data.default };
  },

  // Core Operations
  async balance(args) {
    const { wallet, config } = await initWallet(args[0]);
    try {
      const { balance, tokenBalances } = await wallet.getBalance();
      const tokens = [];
      for (const [tokenId, data] of tokenBalances) {
        tokens.push({
          tokenId,
          balance: data.balance.toString(),
          name: data.tokenMetadata?.tokenName,
          ticker: data.tokenMetadata?.tokenTicker
        });
      }
      return {
        wallet: config.name,
        balanceSats: balance.toString(),
        balanceBtc: (Number(balance) / 1e8).toFixed(8),
        tokens
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  async address(args) {
    const { wallet, config } = await initWallet(args[0]);
    try {
      const sparkAddress = await wallet.getSparkAddress();
      const staticDepositAddress = await wallet.getStaticDepositAddress();
      return {
        wallet: config.name,
        sparkAddress,
        staticDepositAddress
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  // Get current BTC price
  async price() {
    const btcPrice = await getBtcPrice();
    return {
      btcUsd: btcPrice,
      timestamp: new Date().toISOString()
    };
  },

  // Flashnet AMM - List pools
  async pools(args) {
    const { client, wallet, config } = await initFlashnetClient(args[0]);
    try {
      const response = await client.listPools({
        sort: 'TVL_DESC',
        limit: 20
      });
      
      return {
        wallet: config.name,
        totalPools: response.totalCount,
        pools: response.pools.map(p => ({
          id: p.lpPublicKey,
          assetA: p.assetAAddress.substring(0, 16) + '...',
          assetB: p.assetBAddress.substring(0, 16) + '...',
          tvl: p.tvlAssetB,
          volume24h: p.volume24hAssetB,
          curveType: p.curveType
        }))
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  // Flashnet AMM - Simulate swap
  async swapQuote(args) {
    // swap-quote <from_token> <to_token> <amount> [wallet]
    // amount is in human units (e.g., 5 for $5 USDB, 0.001 for BTC)
    const [fromToken, toToken, amountStr, walletName] = args;
    if (!fromToken || !toToken || !amountStr) {
      throw new Error('Usage: spark-wallet swap-quote <from_token> <to_token> <amount> [wallet]');
    }
    
    const { client, wallet, config } = await initFlashnetClient(walletName);
    try {
      const fromInfo = resolveToken(fromToken);
      const toInfo = resolveToken(toToken);
      const amount = parseFloat(amountStr);
      const rawAmount = toRawAmount(amount, fromInfo.decimals);
      
      // Find pool for this pair
      const pools = await client.listPools({
        assetAAddress: fromInfo.assetId,
        assetBAddress: toInfo.assetId,
        limit: 1
      });
      
      let poolId;
      let reversed = false;
      
      if (pools.pools.length > 0) {
        poolId = pools.pools[0].lpPublicKey;
      } else {
        // Try reversed pair
        const reversedPools = await client.listPools({
          assetAAddress: toInfo.assetId,
          assetBAddress: fromInfo.assetId,
          limit: 1
        });
        if (reversedPools.pools.length > 0) {
          poolId = reversedPools.pools[0].lpPublicKey;
          reversed = true;
        } else {
          throw new Error(`No pool found for ${fromInfo.ticker}/${toInfo.ticker}`);
        }
      }
      
      // Simulate swap
      const simulation = await client.simulateSwap({
        poolId,
        assetInAddress: fromInfo.assetId,
        assetOutAddress: toInfo.assetId,
        amountIn: rawAmount.toString()
      });
      
      const amountOut = fromRawAmount(BigInt(simulation.amountOut), toInfo.decimals);
      
      return {
        wallet: config.name,
        poolId,
        from: { token: fromInfo.ticker, amount, raw: rawAmount.toString() },
        to: { token: toInfo.ticker, amount: amountOut, raw: simulation.amountOut },
        executionPrice: simulation.executionPrice,
        priceImpact: simulation.priceImpactPct + '%'
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  // Flashnet AMM - Execute swap
  async swap(args) {
    // swap <from_token> <to_token> <amount> [slippage_bps] [wallet]
    // amount is in human units
    const [fromToken, toToken, amountStr, ...rest] = args;
    if (!fromToken || !toToken || !amountStr) {
      throw new Error('Usage: spark-wallet swap <from_token> <to_token> <amount> [slippage_bps] [wallet]');
    }
    
    const data = loadWallets();
    let walletName;
    let slippageBps = 100; // Default 1%
    
    for (const arg of rest) {
      if (data.wallets[arg]) {
        walletName = arg;
      } else if (/^\d+$/.test(arg)) {
        slippageBps = parseInt(arg, 10);
      }
    }
    
    const { client, wallet, config } = await initFlashnetClient(walletName);
    try {
      const fromInfo = resolveToken(fromToken);
      const toInfo = resolveToken(toToken);
      const amount = parseFloat(amountStr);
      const rawAmount = toRawAmount(amount, fromInfo.decimals);
      
      // Find pool
      let pools = await client.listPools({
        assetAAddress: fromInfo.assetId,
        assetBAddress: toInfo.assetId,
        limit: 1
      });
      
      let poolId;
      if (pools.pools.length > 0) {
        poolId = pools.pools[0].lpPublicKey;
      } else {
        pools = await client.listPools({
          assetAAddress: toInfo.assetId,
          assetBAddress: fromInfo.assetId,
          limit: 1
        });
        if (pools.pools.length > 0) {
          poolId = pools.pools[0].lpPublicKey;
        } else {
          throw new Error(`No pool found for ${fromInfo.ticker}/${toInfo.ticker}`);
        }
      }
      
      // Simulate first
      const simulation = await client.simulateSwap({
        poolId,
        assetInAddress: fromInfo.assetId,
        assetOutAddress: toInfo.assetId,
        amountIn: rawAmount.toString()
      });
      
      // Calculate min output with slippage
      const minAmountOut = BigInt(simulation.amountOut) * BigInt(10000 - slippageBps) / 10000n;
      
      // Execute swap
      const swapResult = await client.executeSwap({
        poolId,
        assetInAddress: fromInfo.assetId,
        assetOutAddress: toInfo.assetId,
        amountIn: rawAmount.toString(),
        minAmountOut: minAmountOut.toString(),
        maxSlippageBps: slippageBps
      });
      
      const amountOut = fromRawAmount(BigInt(swapResult.amountOut), toInfo.decimals);
      
      return {
        wallet: config.name,
        success: true,
        from: { token: fromInfo.ticker, amount, raw: rawAmount.toString() },
        to: { token: toInfo.ticker, amount: amountOut, raw: swapResult.amountOut },
        transferId: swapResult.outboundTransferId,
        priceImpact: simulation.priceImpactPct + '%'
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  // Natural language buy: "buy <$amount> <of_token> [with <pay_token>] [wallet]"
  // e.g., buy 5 usdb btc -> buy $5 worth of USDB, paying with BTC
  // e.g., buy 5 btc usdb -> buy $5 worth of BTC, paying with USDB
  async buy(args) {
    // buy <usd_amount> <buy_token> [pay_token] [wallet]
    // Defaults: pay_token = usdb if buying btc, btc if buying usdb
    const [amountStr, buyToken, ...rest] = args;
    if (!amountStr || !buyToken) {
      throw new Error('Usage: spark-wallet buy <usd_amount> <buy_token> [pay_token] [wallet]');
    }
    
    const data = loadWallets();
    let walletName;
    let payToken;
    
    for (const arg of rest) {
      if (data.wallets[arg]) {
        walletName = arg;
      } else if (!payToken) {
        payToken = arg;
      }
    }
    
    const buyInfo = resolveToken(buyToken);
    
    // Default pay token
    if (!payToken) {
      payToken = buyInfo.ticker.toLowerCase() === 'btc' ? 'usdb' : 'btc';
    }
    const payInfo = resolveToken(payToken);
    
    const usdAmount = parseFloat(amountStr);
    const btcPrice = await getBtcPrice();
    
    // Calculate how much of pay token we need
    let payAmount;
    if (payInfo.ticker === 'BTC') {
      // Paying in BTC: $5 / btcPrice = BTC amount
      payAmount = usdAmount / btcPrice;
    } else if (payInfo.ticker === 'USDB') {
      // Paying in USDB: $5 = 5 USDB
      payAmount = usdAmount;
    } else {
      throw new Error('Can only calculate USD amounts for BTC and USDB');
    }
    
    const rawPayAmount = toRawAmount(payAmount, payInfo.decimals);
    
    const { client, wallet, config } = await initFlashnetClient(walletName);
    try {
      // Find pool
      let pools = await client.listPools({
        assetAAddress: payInfo.assetId,
        assetBAddress: buyInfo.assetId,
        limit: 1
      });
      
      let poolId;
      if (pools.pools.length > 0) {
        poolId = pools.pools[0].lpPublicKey;
      } else {
        pools = await client.listPools({
          assetAAddress: buyInfo.assetId,
          assetBAddress: payInfo.assetId,
          limit: 1
        });
        if (pools.pools.length > 0) {
          poolId = pools.pools[0].lpPublicKey;
        } else {
          throw new Error(`No pool found for ${payInfo.ticker}/${buyInfo.ticker}`);
        }
      }
      
      // Simulate
      const simulation = await client.simulateSwap({
        poolId,
        assetInAddress: payInfo.assetId,
        assetOutAddress: buyInfo.assetId,
        amountIn: rawPayAmount.toString()
      });
      
      // Execute with 1% slippage
      const minAmountOut = BigInt(simulation.amountOut) * 99n / 100n;
      
      const swapResult = await client.executeSwap({
        poolId,
        assetInAddress: payInfo.assetId,
        assetOutAddress: buyInfo.assetId,
        amountIn: rawPayAmount.toString(),
        minAmountOut: minAmountOut.toString(),
        maxSlippageBps: 100
      });
      
      const receivedAmount = fromRawAmount(BigInt(swapResult.amountOut), buyInfo.decimals);
      
      return {
        wallet: config.name,
        success: true,
        usdAmount,
        btcPrice,
        paid: { token: payInfo.ticker, amount: payAmount, raw: rawPayAmount.toString() },
        received: { token: buyInfo.ticker, amount: receivedAmount, raw: swapResult.amountOut },
        transferId: swapResult.outboundTransferId
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  // Spark Transfers (Free, Instant)
  async send(args) {
    const [toAddress, amountStr, walletName] = args;
    if (!toAddress || !amountStr) {
      throw new Error('Usage: spark-wallet send <to_spark_address> <amount_sats> [wallet]');
    }
    
    const { wallet, config } = await initWallet(walletName);
    try {
      const amountSats = parseInt(amountStr, 10);
      const result = await wallet.transfer({
        receiverSparkAddress: toAddress,
        amountSats
      });
      return {
        wallet: config.name,
        to: toAddress,
        amountSats,
        transfer: result
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  async sendTokens(args) {
    const [toAddress, tokenId, amountStr, walletName] = args;
    if (!toAddress || !tokenId || !amountStr) {
      throw new Error('Usage: spark-wallet send-tokens <to_spark_address> <token_id> <amount> [wallet]');
    }
    
    const { wallet, config } = await initWallet(walletName);
    try {
      const result = await wallet.transferTokens({
        receiverSparkAddress: toAddress,
        tokenIdentifier: tokenId,
        tokenAmount: BigInt(amountStr)
      });
      return {
        wallet: config.name,
        to: toAddress,
        tokenId,
        amount: amountStr,
        txId: result.transactionId
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  // Lightning Operations
  async lnInvoice(args) {
    const [amountStr, ...rest] = args;
    if (!amountStr) {
      throw new Error('Usage: spark-wallet ln-invoice <amount_sats> [memo] [wallet]');
    }
    
    const data = loadWallets();
    let walletName, memo;
    if (rest.length > 0 && data.wallets[rest[rest.length - 1]]) {
      walletName = rest.pop();
      memo = rest.join(' ') || undefined;
    } else {
      memo = rest.join(' ') || undefined;
    }
    
    const { wallet, config } = await initWallet(walletName);
    try {
      const invoice = await wallet.createLightningInvoice({
        amountSats: parseInt(amountStr, 10),
        memo,
        includeSparkAddress: true
      });
      return {
        wallet: config.name,
        invoiceId: invoice.id,
        bolt11: invoice.invoice.encodedInvoice,
        amountSats: amountStr,
        memo,
        expiresAt: invoice.invoice.expiresAt
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  async lnPay(args) {
    const [invoice, ...rest] = args;
    if (!invoice) {
      throw new Error('Usage: spark-wallet ln-pay <bolt11_invoice> [max_fee_sats] [wallet]');
    }
    
    const data = loadWallets();
    let walletName, maxFeeSats;
    
    for (const arg of rest) {
      if (data.wallets[arg]) {
        walletName = arg;
      } else if (/^\d+$/.test(arg)) {
        maxFeeSats = parseInt(arg, 10);
      }
    }
    
    const { wallet, config } = await initWallet(walletName);
    try {
      const feeEstimate = await wallet.getLightningSendFeeEstimate({
        encodedInvoice: invoice
      });
      
      const fee = maxFeeSats || Math.max(5, feeEstimate + 5);
      
      const payment = await wallet.payLightningInvoice({
        invoice,
        maxFeeSats: fee,
        preferSpark: true
      });
      
      return {
        wallet: config.name,
        paymentId: payment.id,
        status: payment.status,
        feeEstimate,
        maxFeeUsed: fee
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  async lnFee(args) {
    const [invoice, walletName] = args;
    if (!invoice) {
      throw new Error('Usage: spark-wallet ln-fee <bolt11_invoice> [wallet]');
    }
    
    const { wallet, config } = await initWallet(walletName);
    try {
      const fee = await wallet.getLightningSendFeeEstimate({
        encodedInvoice: invoice
      });
      return {
        wallet: config.name,
        feeEstimateSats: fee,
        invoice: invoice.substring(0, 30) + '...'
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  // L1 Operations
  async l1Withdraw(args) {
    const [btcAddress, amountStr, ...rest] = args;
    if (!btcAddress || !amountStr) {
      throw new Error('Usage: spark-wallet l1-withdraw <btc_address> <amount_sats> [speed] [wallet]');
    }
    
    const data = loadWallets();
    let walletName, speed = 'medium';
    
    for (const arg of rest) {
      if (['fast', 'medium', 'slow'].includes(arg)) {
        speed = arg;
      } else if (data.wallets[arg]) {
        walletName = arg;
      }
    }
    
    const { wallet, config } = await initWallet(walletName);
    try {
      const amountSats = parseInt(amountStr, 10);
      
      const quote = await wallet.getWithdrawalFeeQuote({
        amountSats,
        withdrawalAddress: btcAddress
      });
      
      if (!quote) throw new Error('Unable to get withdrawal fee quote');
      
      let feeAmountSats;
      switch (speed) {
        case 'fast':
          feeAmountSats = (quote.l1BroadcastFeeFast?.originalValue || 0) +
                          (quote.userFeeFast?.originalValue || 0);
          break;
        case 'medium':
          feeAmountSats = (quote.l1BroadcastFeeMedium?.originalValue || 0) +
                          (quote.userFeeMedium?.originalValue || 0);
          break;
        case 'slow':
          feeAmountSats = (quote.l1BroadcastFeeSlow?.originalValue || 0) +
                          (quote.userFeeSlow?.originalValue || 0);
          break;
      }
      
      const withdrawal = await wallet.withdraw({
        onchainAddress: btcAddress,
        exitSpeed: speed,
        amountSats,
        feeQuoteId: quote.id,
        feeAmountSats,
        deductFeeFromWithdrawalAmount: false
      });
      
      return {
        wallet: config.name,
        withdrawalId: withdrawal.id,
        status: withdrawal.status,
        to: btcAddress,
        amountSats,
        speed,
        feeSats: feeAmountSats
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  async l1WithdrawQuote(args) {
    const [btcAddress, amountStr, walletName] = args;
    if (!btcAddress || !amountStr) {
      throw new Error('Usage: spark-wallet l1-withdraw-quote <btc_address> <amount_sats> [wallet]');
    }
    
    const { wallet, config } = await initWallet(walletName);
    try {
      const quote = await wallet.getWithdrawalFeeQuote({
        amountSats: parseInt(amountStr, 10),
        withdrawalAddress: btcAddress
      });
      
      if (!quote) throw new Error('Unable to get fee quote');
      
      return {
        wallet: config.name,
        quoteId: quote.id,
        fast: {
          l1Fee: quote.l1BroadcastFeeFast?.originalValue,
          userFee: quote.userFeeFast?.originalValue,
          total: (quote.l1BroadcastFeeFast?.originalValue || 0) + (quote.userFeeFast?.originalValue || 0)
        },
        medium: {
          l1Fee: quote.l1BroadcastFeeMedium?.originalValue,
          userFee: quote.userFeeMedium?.originalValue,
          total: (quote.l1BroadcastFeeMedium?.originalValue || 0) + (quote.userFeeMedium?.originalValue || 0)
        },
        slow: {
          l1Fee: quote.l1BroadcastFeeSlow?.originalValue,
          userFee: quote.userFeeSlow?.originalValue,
          total: (quote.l1BroadcastFeeSlow?.originalValue || 0) + (quote.userFeeSlow?.originalValue || 0)
        },
        expiresAt: quote.expiryTime
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  async checkDeposits(args) {
    const data = loadWallets();
    const results = [];
    
    for (const [name, walletData] of Object.entries(data.wallets)) {
      if (!walletData.staticDepositAddress) continue;
      
      try {
        const address = walletData.staticDepositAddress;
        const response = await fetch(`https://mempool.space/api/address/${address}/txs`);
        const txs = await response.json();
        
        const pendingDeposits = txs.filter(tx => {
          return tx.vout.some(out => out.scriptpubkey_address === address);
        });
        
        if (pendingDeposits.length > 0) {
          results.push({
            wallet: name,
            address,
            pendingDeposits: pendingDeposits.map(tx => ({
              txid: tx.txid,
              confirmed: tx.status.confirmed,
              blockHeight: tx.status.block_height,
              amount: tx.vout.find(out => out.scriptpubkey_address === address)?.value
            }))
          });
        }
      } catch (e) {
        results.push({ wallet: name, error: e.message });
      }
    }
    
    return { checked: Object.keys(data.wallets).length, results };
  },

  async claimDeposit(args) {
    const [txid, walletName] = args;
    if (!txid) {
      throw new Error('Usage: spark-wallet claim-deposit <txid> [wallet]');
    }
    
    const { wallet, config } = await initWallet(walletName);
    try {
      const quote = await wallet.getClaimStaticDepositQuote(txid);
      
      const result = await wallet.claimStaticDeposit({
        transactionId: txid,
        creditAmountSats: quote.creditAmountSats,
        sspSignature: quote.signature
      });
      
      return {
        wallet: config.name,
        txid,
        creditAmountSats: quote.creditAmountSats,
        claimed: true,
        result
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  async history(args) {
    const [limitStr, walletName] = args;
    const limit = parseInt(limitStr, 10) || 20;
    
    const { wallet, config } = await initWallet(walletName);
    try {
      const { transfers } = await wallet.getTransfers(limit);
      return {
        wallet: config.name,
        transfers: transfers.map(t => ({
          id: t.id,
          status: t.status,
          totalValue: t.totalValue?.toString(),
          createdAt: t.createdAt
        }))
      };
    } finally {
      await wallet.cleanupConnections();
    }
  },

  async help() {
    return {
      commands: {
        'Wallet Management': {
          'create <name> [mnemonic]': 'Create or import a wallet',
          'list': 'List all wallets',
          'use <name>': 'Set default wallet',
          'delete <name>': 'Delete a wallet'
        },
        'Core Operations': {
          'balance [wallet]': 'Get wallet balance (BTC + tokens)',
          'address [wallet]': 'Get Spark and L1 deposit addresses',
          'send <to> <sats> [wallet]': 'Send BTC on Spark (free, instant)',
          'send-tokens <to> <token_id> <amount> [wallet]': 'Send tokens on Spark',
          'history [limit] [wallet]': 'View transfer history',
          'price': 'Get current BTC/USD price'
        },
        'Trading (Flashnet AMM)': {
          'pools [wallet]': 'List available trading pools',
          'swap-quote <from> <to> <amount> [wallet]': 'Get swap quote',
          'swap <from> <to> <amount> [slippage_bps] [wallet]': 'Execute swap',
          'buy <$amount> <token> [pay_token] [wallet]': 'Buy token with USD amount'
        },
        'Lightning': {
          'ln-invoice <sats> [memo] [wallet]': 'Create Lightning invoice',
          'ln-pay <bolt11> [max_fee] [wallet]': 'Pay Lightning invoice',
          'ln-fee <bolt11> [wallet]': 'Estimate Lightning payment fee'
        },
        'L1 (On-chain)': {
          'l1-withdraw <btc_addr> <sats> [speed] [wallet]': 'Withdraw to L1',
          'l1-withdraw-quote <btc_addr> <sats> [wallet]': 'Get withdrawal fee quote',
          'check-deposits': 'Check all wallets for pending L1 deposits',
          'claim-deposit <txid> [wallet]': 'Claim an L1 deposit'
        }
      },
      tokens: {
        'BTC': BTC_ASSET_ID,
        'USDB (Flashnet)': USDB_ASSET_ID,
        'USDB (Spark)': USDB_TOKEN_ID
      }
    };
  }
};

// Command name normalization
const commandAliases = {
  'send-tokens': 'sendTokens',
  'ln-invoice': 'lnInvoice',
  'ln-pay': 'lnPay',
  'ln-fee': 'lnFee',
  'l1-withdraw': 'l1Withdraw',
  'l1-withdraw-quote': 'l1WithdrawQuote',
  'check-deposits': 'checkDeposits',
  'claim-deposit': 'claimDeposit',
  'swap-quote': 'swapQuote'
};

// Main
async function main() {
  const [,, cmd, ...args] = process.argv;
  
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(JSON.stringify(await commands.help(), null, 2));
    return;
  }
  
  const commandName = commandAliases[cmd] || cmd;
  const handler = commands[commandName];
  
  if (!handler) {
    console.error(JSON.stringify({ error: `Unknown command: ${cmd}. Run 'spark-wallet help' for usage.` }));
    process.exit(1);
  }
  
  try {
    const result = await handler(args);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
  }
}

main();
