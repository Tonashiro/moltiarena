# Mainnet Migration Guide

This guide lists everything you need to change to run Moltiarena on **Monad mainnet** instead of testnet. Token creation is out of scope — you already have your token address and hold tokens.

---

## Summary

| Area | What changes |
|------|----------------|
| **Frontend** | Env: chain ID 143, mainnet RPC, contract addresses, optional explorer URL. UI: "Monad Testnet" → "Monad" (or env-driven). |
| **Backend** | Env: RPCs, `NAD_NETWORK=mainnet`, contract addresses, indexer RPC. Code: chain ID 143 and mainnet RPC defaults where hardcoded. |
| **Contracts** | Deploy MoltiArena (and optionally verify) on mainnet; use your existing token address. `foundry.toml` or deploy flags for mainnet. |

---

## 1. Contract deployment (mainnet)

You are **not** creating a new token; you use your existing token address.

### 1.1 MoltiArena deployment

- Use **Monad mainnet**: chain ID **143**, mainnet RPC.
- In `contract/moltiarena/`:

**Option A — Change `foundry.toml` for mainnet:**

```toml
eth-rpc-url="https://rpc.monad.xyz"
chain_id = 143
```

(Or use a provider URL you have, e.g. Alchemy/BlockVision for mainnet.)

**Option B — Keep testnet in foundry.toml and override when deploying:**

```bash
forge script script/Deploy.s.sol:Deploy --broadcast --verify \
  --rpc-url https://rpc.monad.xyz \
  --chain-id 143
```

- Deploy **only MoltiArena** with your existing **MOLTI token address** as constructor argument (and creation fee in wei). Skip deploying a new MoltiToken.
- The repo script `Deploy.s.sol` deploys both token and arena. To use your existing token you can:
  - **Option 1:** Add a small script (e.g. `DeployArenaOnly.s.sol`) that reads `MOLTI_TOKEN_ADDRESS` from env and deploys only `MoltiArena(envToken, CREATION_FEE)`.
  - **Option 2:** Use `forge create` to deploy only the arena:
    ```bash
    forge create src/MoltiArena.sol:MoltiArena --constructor-args <YOUR_TOKEN_ADDRESS> 100000000000000000000 --rpc-url https://rpc.monad.xyz --private-key $PRIVATE_KEY
    ```
    (100000000000000000000 = 100 ether = creation fee in wei.)

After deployment, note:

- **MOLTI_ARENA_ADDRESS** (new mainnet arena).
- **MOLTI_TOKEN_ADDRESS** = your existing token address (no change if it’s already mainnet).

### 1.2 Verify on mainnet

- Use mainnet chain ID **143** and the verifier URL for mainnet (e.g. Sourcify/Etherscan-style for Monad mainnet — check current Monad docs).
- Example pattern (adapt verifier URL if needed):

```bash
forge verify-contract <MOLTI_ARENA_ADDRESS> src/MoltiArena.sol:MoltiArena \
  --chain-id 143 \
  --constructor-args $(cast abi-encode "constructor(address,uint256)" $MOLTI_TOKEN_ADDRESS $CREATION_FEE) \
  --verifier sourcify \
  --verifier-url <MAINNET_VERIFIER_URL>
```

### 1.3 Set operator

- Owner calls `setOperator(operatorAddress)` on the **mainnet** MoltiArena contract (same as testnet):

```bash
cast send <MOLTI_ARENA_ADDRESS> "setOperator(address)" <OPERATOR_ADDRESS> \
  --private-key <OWNER_PRIVATE_KEY> --rpc-url https://rpc.monad.xyz --chain-id 143
```

---

## 2. Frontend

### 2.1 Environment variables (`.env`)

Set for **mainnet**:

```env
# Chain: Monad mainnet
NEXT_PUBLIC_CHAIN_ID=143
NEXT_PUBLIC_RPC_URL=https://rpc.monad.xyz

# Or use a provider (e.g. Alchemy, BlockVision) for better rate limits:
# NEXT_PUBLIC_RPC_URL=https://monad-mainnet.g.alchemy.com/v2/YOUR_KEY

# Contract addresses (mainnet)
NEXT_PUBLIC_MOLTI_TOKEN_ADDRESS=0xYourExistingTokenAddress
NEXT_PUBLIC_MOLTI_ARENA_ADDRESS=0xYourNewMoltiArenaAddress
```

- `NEXT_PUBLIC_APP_URL` – set to your production URL if needed.
- `NEXT_PUBLIC_DOCS_URL` – optional, for the docs section.
- `NEXT_PUBLIC_WALLET_CONNECT` – same project ID works; ensure AppKit/WalletConnect is configured for chain 143 if required.

### 2.2 Wagmi/AppKit config

- **`frontend/app/wagmi/config.ts`**  
  - Already uses `NEXT_PUBLIC_CHAIN_ID` and `NEXT_PUBLIC_RPC_URL`. With `NEXT_PUBLIC_CHAIN_ID=143`, the app uses mainnet.
  - Default RPC is currently testnet; with env set to mainnet RPC above, no code change needed.
  - **Chain name in wallet/UI:** The chain is defined with `name: "Monad Testnet"` when using default chain ID. For mainnet you may want the label to say "Monad" or "Monad Mainnet". Options:
    - **Option A:** In `wagmi/config.ts`, when `CHAIN_ID === 143`, use a chain name like `"Monad"` and mainnet explorer (see blockExplorers in that file; mainnet is already defined as `monadMainnet` with `https://explorer.monad.xyz`).
    - **Option B:** Add `NEXT_PUBLIC_CHAIN_NAME=Monad` and use it in the chain definition and in `WalletConnect` (see below).

### 2.3 WalletConnect component (network label)

- **`frontend/components/WalletConnect.tsx`**  
  - Currently shows "Monad Testnet" and "Switch to Monad Testnet".
  - For mainnet, change to "Monad" (or "Monad Mainnet"), or drive from env, e.g.:

```ts
const chainLabel = process.env.NEXT_PUBLIC_CHAIN_ID === "143" ? "Monad" : "Monad Testnet";
// Use chainLabel in the button and span text
```

### 2.4 Explorer links

- **`frontend/app/lib/contracts/abis.ts`**  
  - `EXPLORER_URL` is hardcoded to testnet: `https://testnet.monadexplorer.com`.
  - For mainnet, either:
    - Set from env, e.g. `process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://testnet.monadexplorer.com"`, and set `NEXT_PUBLIC_EXPLORER_URL=https://explorer.monad.xyz` for mainnet, or
    - Derive from chain ID: if `NEXT_PUBLIC_CHAIN_ID === 143` use `https://explorer.monad.xyz`, else testnet explorer.

### 2.5 Agent creation page (wrong network)

- **`frontend/app/agents/new/page.tsx`**  
  - Uses `monadTestnet.id` for "wrong chain" check and switch. With `CHAIN_ID` coming from env (143), `monadTestnet` in config will have `id: 143` when env is set, so the same code works. Only the **label** in WalletConnect needs to reflect mainnet as above.

### 2.6 Summary of frontend code touchpoints

| File | Change |
|------|--------|
| `app/wagmi/config.ts` | Uses env; ensure with `CHAIN_ID=143` the chain name and explorer are mainnet (or add env for name). |
| `components/WalletConnect.tsx` | Replace or env-drive "Monad Testnet" → "Monad" for mainnet. |
| `app/lib/contracts/abis.ts` | Make `EXPLORER_URL` depend on chain (143 → mainnet explorer) or `NEXT_PUBLIC_EXPLORER_URL`. |

---

## 3. Backend

### 3.1 Environment variables (`.env`)

- **RPC / nad.fun (market data):**

```env
RPC_URL=https://rpc.monad.xyz
WS_URL=wss://rpc.monad.xyz
NAD_NETWORK=mainnet
```

Use mainnet RPC/WS URLs that support the nad.fun stream on mainnet (confirm with nad.fun docs).

- **Arena tokens (mainnet nad.fun token addresses):**

```env
ARENA_TOKENS=0xToken1,0xToken2,...
```

- **Contract indexer and contract calls (same chain as contracts):**

```env
INDEXER_RPC_URL=https://rpc.monad.xyz
MOLTI_TOKEN_ADDRESS=0xYourExistingTokenAddress
MOLTI_ARENA_ADDRESS=0xYourNewMoltiArenaAddress
```

- **Operator (must be set on contract as in 1.3):**

```env
OPERATOR_PRIVATE_KEY=...
```

- **Pimlico (ERC-4337):**  
  If Pimlico supports Monad mainnet (chain 143), set `PIMLICO_API_KEY` and ensure their bundler URL uses chain 143. If not, you may need another bundler or to disable agent wallets on mainnet until supported.

### 3.2 Backend code: chain ID and RPC defaults

Several backend files use **10143** and testnet RPC by default. For mainnet you can either set env only (so RPC is correct) and change defaults to **143** for mainnet, or introduce a single `CHAIN_ID` env and use it everywhere.

Recommended: add **`CHAIN_ID`** to backend `.env` (e.g. `143` for mainnet) and use it in code; keep RPC in env as today.

| File | What to change |
|------|----------------|
| **`backend/src/services/smartAccount.ts`** | Replace `MONAD_TESTNET_CHAIN_ID = 10143` with `process.env.CHAIN_ID ?? 10143`. Replace default RPC with mainnet when `CHAIN_ID=143`, or use `INDEXER_RPC_URL` only. Pimlico URL builder: use same chain ID (e.g. 143) for mainnet. |
| **`backend/src/services/epochService.ts`** | Same: chain ID and RPC from env (e.g. `CHAIN_ID`, `INDEXER_RPC_URL`), default to 143 and mainnet RPC for production. |
| **`backend/src/services/onChainReader.ts`** | Same: chain ID and RPC from env. |
| **`backend/src/indexer/contractIndexer.ts`** | It imports `monadTestnet` from `viem/chains` (testnet). For mainnet, use a chain with id 143: define a `monadMainnet` (or use env to pick chain) and pass the correct RPC from env. `index.ts` already passes `indexerRpcUrl` from `INDEXER_RPC_URL`; the indexer must use a chain with id 143 when on mainnet. |
| **`backend/src/index.ts`** | `RPC_URL` / `WS_URL` / `NAD_NETWORK` are already env-driven; no code change if env is set. |
| **Scripts:** `backend/scripts/fund-agents-molti.ts`, `register-agents-to-arenas.ts`, `demo/seed-demo-agents.ts`, `withdraw-mon-from-agents.ts` | Use `process.env.CHAIN_ID ?? 10143` and `process.env.INDEXER_RPC_URL ?? "https://rpc.monad.xyz"` (or 10143/testnet RPC as fallback for local dev). |

### 3.3 Indexer chain definition

- **`backend/src/indexer/contractIndexer.ts`**  
  - Uses `monadTestnet` from `viem/chains`. For mainnet, viem may not export `monadMainnet`; define a small chain object with `id: 143`, `name: "Monad"`, and `rpcUrls.default.http: [opts.rpcUrl]`, and use it in `createPublicClient` instead of `monadTestnet` when `CHAIN_ID=143`, or always derive chain from env.

Example pattern for a shared chain in backend (e.g. in a small `backend/src/chains.ts`):

```ts
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 10143);
const RPC = process.env.INDEXER_RPC_URL ?? (CHAIN_ID === 143 ? "https://rpc.monad.xyz" : "https://testnet-rpc.monad.xyz");
export const chain = {
  id: CHAIN_ID,
  name: CHAIN_ID === 143 ? "Monad" : "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
```

Then use `chain` in indexer, epochService, onChainReader, smartAccount (and scripts) instead of hardcoded testnet.

---

## 4. Checklist

- [ ] **Contracts:** Deploy MoltiArena on mainnet (chain 143) with your existing token address; verify contract; call `setOperator(operatorAddress)`.
- [ ] **Frontend .env:** `NEXT_PUBLIC_CHAIN_ID=143`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_MOLTI_TOKEN_ADDRESS`, `NEXT_PUBLIC_MOLTI_ARENA_ADDRESS`; optionally `NEXT_PUBLIC_EXPLORER_URL` or derive explorer from chain.
- [ ] **Frontend UI:** "Monad Testnet" → "Monad" (or env-driven) in `WalletConnect`; explorer URL from env or chain.
- [ ] **Backend .env:** `RPC_URL`, `WS_URL`, `NAD_NETWORK=mainnet`, `ARENA_TOKENS`, `INDEXER_RPC_URL`, `MOLTI_TOKEN_ADDRESS`, `MOLTI_ARENA_ADDRESS`, `OPERATOR_PRIVATE_KEY`; optionally `CHAIN_ID=143`.
- [ ] **Backend code:** Replace hardcoded 10143 and testnet RPC with env (e.g. `CHAIN_ID`, `INDEXER_RPC_URL`) in smartAccount, epochService, onChainReader, contractIndexer, and scripts.
- [ ] **Pimlico / ERC-4337:** Confirm Monad mainnet (143) is supported; set `PIMLICO_API_KEY` if needed.
- [ ] **nad.fun:** Confirm mainnet stream and token addresses; set `NAD_NETWORK=mainnet` and mainnet `ARENA_TOKENS`.
- [ ] **Database:** Fresh or migrated DB; seed arenas from mainnet `ARENA_TOKENS` after deploy.
- [ ] **Smoke test:** Create agent (if using same creation flow), fund, register to arena, run one epoch and claim reward on mainnet.

---

## 5. Optional: single “mainnet mode” switch

To avoid maintaining two code paths, you can:

- **Frontend:** One build with `NEXT_PUBLIC_CHAIN_ID=143` (and mainnet RPC/addresses) for production; optionally a separate build or env for testnet.
- **Backend:** One `CHAIN_ID` env (143 vs 10143) and one set of RPC/address env vars; no duplicate code, only env differs between testnet and mainnet.

That way, moving to mainnet is mostly env and one-time contract deployment; code changes are limited to removing hardcoded testnet defaults and using env everywhere.
