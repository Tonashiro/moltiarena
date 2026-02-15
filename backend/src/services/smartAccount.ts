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
  createPublicClient,
  http,
  readContract,
  getBalance,
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
import { MOLTI_TOKEN_ADDRESS, MOLTI_TOKEN_ABI, MOLTI_ARENA_ADDRESS, MOLTI_ARENA_ABI } from "../contracts/abis.js";

// ─── Configuration ────────────────────────────────────────────────────

const MONAD_TESTNET_CHAIN_ID = 10143;
const MONAD_TESTNET_RPC = process.env.INDEXER_RPC_URL ?? "https://testnet-rpc.monad.xyz";

function getPimlicoUrl(): string {
  const apiKey = process.env.PIMLICO_API_KEY;
  if (apiKey) {
    return `https://api.pimlico.io/v2/${MONAD_TESTNET_CHAIN_ID}/rpc?apikey=${apiKey}`;
  }
  // Public endpoint: 20 req/min rate limit
  return `https://public.pimlico.io/v2/${MONAD_TESTNET_CHAIN_ID}/rpc`;
}

// Monad Testnet chain definition for viem
const monadTestnet = {
  id: MONAD_TESTNET_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [MONAD_TESTNET_RPC] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
} as const;

// ─── Shared clients (lazy init) ───────────────────────────────────────

let _publicClient: ReturnType<typeof createPublicClient> | null = null;
let _pimlicoClient: ReturnType<typeof createPimlicoClient> | null = null;

function getPublicClient() {
  _publicClient ??= createPublicClient({
    chain: monadTestnet,
    transport: http(MONAD_TESTNET_RPC),
  });
  return _publicClient;
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
    chain: monadTestnet,
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

// ─── On-Chain Deposit & Trade Execution ───────────────────────────────

/** Get native MON balance of an address (e.g. smart account). */
export async function getMonBalance(address: Address): Promise<bigint> {
  const client = getPublicClient();
  return getBalance(client, { address });
}

/** Read the contract's portfolio cashMolti for an agent in an arena */
export async function getContractPortfolio(
  agentOnChainId: number,
  arenaOnChainId: number,
): Promise<{ cashMolti: bigint; tokenUnits: bigint }> {
  const client = getPublicClient();
  const pf = await readContract(client, {
    address: MOLTI_ARENA_ADDRESS,
    abi: MOLTI_ARENA_ABI,
    functionName: "getPortfolio",
    args: [BigInt(agentOnChainId), BigInt(arenaOnChainId)],
  });
  return { cashMolti: pf.cashMolti, tokenUnits: pf.tokenUnits };
}

/**
 * Approve MoltiArena to spend MOLTI from the agent's smart account.
 * Required for autoRenewEpoch (contract pulls 100 MOLTI from agent wallet each epoch).
 * Approves max uint256 so renewals work without repeated approvals.
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
    console.error(`[smartAccount] approveMoltiForArena FAILED:`, err);
    return null;
  }
}

/**
 * Deposit MOLTI from the agent's smart account into the MoltiArena contract.
 * Required when the agent registered with 0 deposit — funds the contract portfolio
 * so executeTrade can run (BUY needs cashMolti > 0).
 */
export async function depositMoltiToArena(params: {
  encryptedSignerKey: string;
  agentOnChainId: number;
  arenaOnChainId: number;
  amountWei: bigint;
}): Promise<Hex | null> {
  const { encryptedSignerKey, agentOnChainId, arenaOnChainId, amountWei } = params;
  if (amountWei <= 0n) return null;

  try {
    const client = await getSmartAccountClient(encryptedSignerKey);

    // Batch approve + depositToArena in one UserOperation
    const txHash = await client.sendTransaction({
      calls: [
        {
          to: MOLTI_TOKEN_ADDRESS,
          data: encodeFunctionData({
            abi: MOLTI_TOKEN_ABI,
            functionName: "approve",
            args: [MOLTI_ARENA_ADDRESS, amountWei],
          }),
        },
        {
          to: MOLTI_ARENA_ADDRESS,
          data: encodeFunctionData({
            abi: MOLTI_ARENA_ABI,
            functionName: "depositToArena",
            args: [
              BigInt(agentOnChainId),
              BigInt(arenaOnChainId),
              amountWei,
            ],
          }),
        },
      ],
    });

    console.log(
      `[smartAccount] Deposited to arena: agent=${agentOnChainId} arena=${arenaOnChainId} ` +
        `amount=${amountWei} tx=${txHash}`,
    );
    return txHash;
  } catch (err) {
    console.error(
      `[smartAccount] depositToArena FAILED: agent=${agentOnChainId} arena=${arenaOnChainId}`,
      err,
    );
    return null;
  }
}

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
  // Multiply by 1e18, using string to avoid floating point precision loss
  const scaled = Math.round(value * 1e18);
  return BigInt(scaled);
}

export interface OnChainTradeParams {
  encryptedSignerKey: string;
  agentOnChainId: number;
  arenaOnChainId: number;
  epochOnChainId: number;
  action: "BUY" | "SELL";
  sizePct: number;  // 0-1 decimal
  price: number;    // decimal token price
  tick: number;
}

/**
 * Submit an on-chain executeTrade call via the agent's ERC-4337 smart account.
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
    price,
    tick,
  } = params;

  try {
    const client = await getSmartAccountClient(encryptedSignerKey);

    const actionEnum = actionToEnum(action);
    const sizePctWei = toWei18(sizePct);
    const priceWei = toWei18(price);

    console.log(
      `[smartAccount] Executing on-chain trade: agent=${agentOnChainId} arena=${arenaOnChainId} epoch=${epochOnChainId} ` +
        `action=${action}(${actionEnum}) sizePct=${sizePct}→${sizePctWei} price=${price}→${priceWei} tick=${tick}`,
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
