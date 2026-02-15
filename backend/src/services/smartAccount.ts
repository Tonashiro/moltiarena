/**
 * Smart Account Service
 *
 * Manages ERC-4337 SimpleAccount wallets for agents using permissionless.js.
 * Each agent gets a counterfactual SimpleAccount controlled by an encrypted signer key.
 *
 * Dependencies: permissionless, viem
 * Infrastructure: Pimlico bundler on Monad Testnet (chain 10143)
 */
import {
  http,
  maxUint256,
  type Hex,
  type Address,
  encodeFunctionData,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { entryPoint07Address } from "viem/account-abstraction";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createSmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { encryptPrivateKey, decryptPrivateKey } from "./keyVault.js";
import { chain, CHAIN_ID, getPublicClient as getSharedPublicClient } from "../chains.js";
import { MOLTI_TOKEN_ADDRESS, MOLTI_TOKEN_ABI, MOLTI_ARENA_ADDRESS, MOLTI_ARENA_ABI } from "../contracts/abis.js";

// ─── Configuration ────────────────────────────────────────────────────

let _pimlicoRateLimitWarned = false;

function getPimlicoUrl(): string {
  const apiKey = process.env.PIMLICO_API_KEY;
  if (apiKey) {
    return `https://api.pimlico.io/v2/${CHAIN_ID}/rpc?apikey=${apiKey}`;
  }
  if (!_pimlicoRateLimitWarned) {
    _pimlicoRateLimitWarned = true;
    console.warn(
      "[smartAccount] PIMLICO_API_KEY not set — using public bundler (≈20 req/min). " +
        "Set PIMLICO_API_KEY in .env to avoid rate limits: https://dashboard.pimlico.io"
    );
  }
  return `https://public.pimlico.io/v2/${CHAIN_ID}/rpc`;
}

// ─── Shared clients (lazy init) ───────────────────────────────────────

let _pimlicoClient: ReturnType<typeof createPimlicoClient> | null = null;

function getPublicClient() {
  return getSharedPublicClient();
}

function getPimlicoClient() {
  if (!_pimlicoClient) {
    _pimlicoClient = createPimlicoClient({
      entryPoint: {
        address: entryPoint07Address,
        version: "0.7",
      },
      transport: http(getPimlicoUrl()),
    });
  }
  return _pimlicoClient;
}

// ─── Public API ───────────────────────────────────────────────────────

export interface CreateWalletResult {
  signerAddress: Address;
  smartAccountAddress: Address;
  encryptedKey: string;
}

/**
 * Generate a new signer key and compute the counterfactual SimpleAccount address.
 * The signer key is encrypted before being returned.
 */
export async function createAgentWallet(): Promise<CreateWalletResult> {
  const signerKey = generatePrivateKey();
  const signerAccount = privateKeyToAccount(signerKey);

  const simpleAccount = await toSimpleSmartAccount({
    client: getPublicClient(),
    owner: signerAccount,
    entryPoint: {
      address: entryPoint07Address,
      version: "0.7",
    },
  });

  const encryptedKey = encryptPrivateKey(signerKey);

  console.log(
    `[smartAccount] Created wallet: signer=${signerAccount.address} smartAccount=${simpleAccount.address}`,
  );

  return {
    signerAddress: signerAccount.address,
    smartAccountAddress: simpleAccount.address,
    encryptedKey,
  };
}

/**
 * Build a SmartAccountClient for an agent, ready to send UserOperations.
 * The signer key is decrypted from the encrypted ciphertext.
 */
export async function getSmartAccountClient(encryptedSignerKey: string) {
  const signerKey = decryptPrivateKey(encryptedSignerKey) as Hex;
  const signerAccount = privateKeyToAccount(signerKey);

  const simpleAccount = await toSimpleSmartAccount({
    client: getPublicClient(),
    owner: signerAccount,
    entryPoint: {
      address: entryPoint07Address,
      version: "0.7",
    },
  });

  const pimlicoClient = getPimlicoClient();

  const client = createSmartAccountClient({
    account: simpleAccount,
    chain,
    bundlerTransport: http(getPimlicoUrl()),
    // No paymaster — agent pays gas from its own MON balance (funded via "Fund MON")
    // Paymaster requires Pimlico sponsorship policy ID, which needs a paid plan
    userOperation: {
      estimateFeesPerGas: async () =>
        (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  });

  return client;
}

/**
 * Execute a withdrawal of MOLTI tokens from the agent's smart account.
 */
export async function withdrawMolti(
  encryptedSignerKey: string,
  toAddress: Address,
  amount: bigint,
): Promise<Hex> {
  const client = await getSmartAccountClient(encryptedSignerKey);

  const txHash = await client.sendTransaction({
    to: MOLTI_TOKEN_ADDRESS,
    data: encodeFunctionData({
      abi: MOLTI_TOKEN_ABI,
      functionName: "transfer",
      args: [toAddress, amount],
    }),
  });

  console.log(
    `[smartAccount] Withdrew MOLTI: to=${toAddress} amount=${amount} tx=${txHash}`,
  );
  return txHash;
}

/**
 * Execute a withdrawal of native MON from the agent's smart account.
 */
export async function withdrawMon(
  encryptedSignerKey: string,
  toAddress: Address,
  amount: bigint,
): Promise<Hex> {
  const client = await getSmartAccountClient(encryptedSignerKey);

  const txHash = await client.sendTransaction({
    to: toAddress,
    value: amount,
  });

  console.log(
    `[smartAccount] Withdrew MON: to=${toAddress} amount=${amount} tx=${txHash}`,
  );
  return txHash;
}

/**
 * Get the smart account address for a given encrypted signer key
 * (without building the full client).
 */
export async function getSmartAccountAddress(
  encryptedSignerKey: string,
): Promise<Address> {
  const signerKey = decryptPrivateKey(encryptedSignerKey) as Hex;
  const signerAccount = privateKeyToAccount(signerKey);

  const simpleAccount = await toSimpleSmartAccount({
    client: getPublicClient(),
    owner: signerAccount,
    entryPoint: {
      address: entryPoint07Address,
      version: "0.7",
    },
  });

  return simpleAccount.address;
}

// ─── On-Chain Balance & Portfolio Reads ───────────────────────────────

/** Get MOLTI token balance of an address (e.g. smart account). */
export async function getMoltiBalance(address: Address): Promise<bigint> {
  const client = getPublicClient();
  return client.readContract({
    address: MOLTI_TOKEN_ADDRESS,
    abi: MOLTI_TOKEN_ABI,
    functionName: "balanceOf",
    args: [address],
  });
}

/** Get native MON balance of an address (e.g. smart account). */
export async function getMonBalance(address: Address): Promise<bigint> {
  const client = getPublicClient();
  return client.getBalance({ address });
}

/** Read the contract portfolio (moltiLocked + tokenUnits) for an agent in an arena. */
export async function getContractPortfolio(
  agentOnChainId: number,
  arenaOnChainId: number,
): Promise<{ moltiLocked: bigint; tokenUnits: bigint }> {
  const client = getPublicClient();
  const pf = await client.readContract({
    address: MOLTI_ARENA_ADDRESS,
    abi: MOLTI_ARENA_ABI,
    functionName: "getPortfolio",
    args: [BigInt(agentOnChainId), BigInt(arenaOnChainId)],
  });
  return { moltiLocked: pf.moltiLocked, tokenUnits: pf.tokenUnits };
}

// ─── MOLTI Approval ──────────────────────────────────────────────────

/**
 * Approve MoltiArena to spend MOLTI from the agent's smart account.
 * Called once at agent creation with maxUint256 so all future BUYs and
 * epoch renewals work without repeated approvals.
 */
export async function approveMoltiForArena(params: {
  encryptedSignerKey: string;
}): Promise<Hex | null> {
  const { encryptedSignerKey } = params;
  try {
    const client = await getSmartAccountClient(encryptedSignerKey);
    const txHash = await client.sendTransaction({
      to: MOLTI_TOKEN_ADDRESS,
      data: encodeFunctionData({
        abi: MOLTI_TOKEN_ABI,
        functionName: "approve",
        args: [MOLTI_ARENA_ADDRESS, maxUint256],
      }),
    });
    console.log(`[smartAccount] MOLTI approved for MoltiArena tx=${txHash}`);
    return txHash;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const is429 =
      msg.includes("rate limit") ||
      msg.includes("429") ||
      (err as { cause?: { status?: number } })?.cause?.status === 429;
    if (is429) {
      console.error(
        "[smartAccount] approveMoltiForArena FAILED: Pimlico rate limit (429). " +
          "Set PIMLICO_API_KEY in .env (https://dashboard.pimlico.io) or wait ~60s and retry."
      );
    } else {
      console.error(`[smartAccount] approveMoltiForArena FAILED:`, err);
    }
    return null;
  }
}

// ─── On-Chain Trade Execution ─────────────────────────────────────────

/** Contract Action enum: BUY=0, SELL=1, HOLD=2 */
function actionToEnum(action: "BUY" | "SELL" | "HOLD"): number {
  switch (action) {
    case "BUY":
      return 0;
    case "SELL":
      return 1;
    case "HOLD":
      return 2;
  }
}

/** Convert a 0-1 decimal percentage to 1e18-scaled bigint (e.g. 0.20 → 200000000000000000n) */
function toWei18(value: number): bigint {
  const scaled = Math.round(value * 1e18);
  return BigInt(scaled);
}

export interface OnChainTradeParams {
  encryptedSignerKey: string;
  agentOnChainId: number;
  arenaOnChainId: number;
  epochOnChainId: number;
  action: "BUY" | "SELL";
  sizePct: number;       // 0-1 decimal (SELL only)
  buyAmountWei?: bigint; // gross MOLTI amount from wallet (BUY only)
  price: number;         // decimal token price
  tick: number;
}

/**
 * Submit an on-chain executeTrade call via the agent's ERC-4337 smart account.
 *
 * BUY: contract pulls buyAmountWei MOLTI from wallet, deducts fee, credits tokens.
 *      Requires infinite approval (done at agent creation).
 * SELL: contract returns proportional moltiLocked to wallet, deducts fee.
 *
 * Returns the transaction hash, or null if the call fails.
 */
export async function executeOnChainTrade(params: OnChainTradeParams): Promise<Hex | null> {
  const {
    encryptedSignerKey,
    agentOnChainId,
    arenaOnChainId,
    epochOnChainId,
    action,
    sizePct,
    buyAmountWei,
    price,
    tick,
  } = params;

  try {
    const client = await getSmartAccountClient(encryptedSignerKey);

    const actionEnum = actionToEnum(action);
    const sizePctWei = action === "SELL" ? toWei18(sizePct) : 0n;
    const buyAmount = action === "BUY" ? (buyAmountWei ?? 0n) : 0n;
    const priceWei = toWei18(price);

    console.log(
      `[smartAccount] Executing on-chain trade: agent=${agentOnChainId} arena=${arenaOnChainId} epoch=${epochOnChainId} ` +
        `action=${action}(${actionEnum}) sizePct=${sizePctWei} buyAmount=${buyAmount} price=${price}→${priceWei} tick=${tick}`,
    );

    const txHash = await client.sendTransaction({
      to: MOLTI_ARENA_ADDRESS,
      data: encodeFunctionData({
        abi: MOLTI_ARENA_ABI,
        functionName: "executeTrade",
        args: [
          BigInt(agentOnChainId),
          BigInt(arenaOnChainId),
          BigInt(epochOnChainId),
          actionEnum,
          sizePctWei,
          buyAmount,
          priceWei,
          tick,
        ],
      }),
    });

    console.log(
      `[smartAccount] On-chain trade submitted: agent=${agentOnChainId} arena=${arenaOnChainId} ` +
        `action=${action} tx=${txHash}`,
    );

    return txHash;
  } catch (err) {
    console.error(
      `[smartAccount] On-chain trade FAILED: agent=${agentOnChainId} arena=${arenaOnChainId} action=${action}`,
      err,
    );
    return null;
  }
}
