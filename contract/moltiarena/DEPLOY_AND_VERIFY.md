# Deploy, Verify, and Set Operator

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) installed (`forge`, `cast`)
- `.env` in `contract/moltiarena/` with `PRIVATE_KEY` (deployer/owner wallet; must have MON for gas)
- For verification: choose Sourcify (no API key) or Etherscan-style (API key if required)

---

## 1. Deploy the contracts

From the **contract/moltiarena** directory:

```bash
cd contract/moltiarena

# Load .env (PRIVATE_KEY must be set)
# Deploy to Monad Testnet (chain 10143, RPC from foundry.toml)
forge script script/Deploy.s.sol:Deploy --broadcast --verify
```

- **Testnet (default):** uses `foundry.toml` RPC (`https://testnet-rpc.monad.xyz`) and chain 10143.
- **Custom RPC:** add `--rpc-url <YOUR_RPC_URL>`.
- **Skip verification:** omit `--verify` and verify later with step 2.

After a successful run, note:

- **MoltiToken** address (first CREATE).
- **MoltiArena** address (second CREATE).

Update `MOLTI_TOKEN_ADDRESS` and `MOLTI_ARENA_ADDRESS` in the **backend** `.env`.

---

## 2. Verify the contracts on-chain (if step 1 did not verify)

If `--verify` in step 1 failed or you skipped it, verify manually.

**MoltiToken** — use the fully qualified name `src/MoltiToken.sol:MoltiToken`:

```bash
# Replace <MOLTI_TOKEN_ADDRESS> and <DEPLOYER_ADDRESS> (initial supply recipient)
export MOLTI_TOKEN_ADDRESS=0x...
export DEPLOYER_ADDRESS=0x...

forge verify-contract $MOLTI_TOKEN_ADDRESS src/MoltiToken.sol:MoltiToken \
  --chain-id 10143 \
  --constructor-args $(cast abi-encode "constructor(address)" $DEPLOYER_ADDRESS) \
  --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/
```

**MoltiArena** — use the fully qualified name `src/MoltiArena.sol:MoltiArena`:

```bash
# Replace <MOLTI_ARENA_ADDRESS> and <MOLTI_TOKEN_ADDRESS>
export MOLTI_ARENA_ADDRESS=0x...
export MOLTI_TOKEN_ADDRESS=0x...
# 100 ether = 100000000000000000000
export CREATION_FEE=100000000000000000000

forge verify-contract $MOLTI_ARENA_ADDRESS src/MoltiArena.sol:MoltiArena \
  --chain-id 10143 \
  --constructor-args $(cast abi-encode "constructor(address,uint256)" $MOLTI_TOKEN_ADDRESS $CREATION_FEE) \
  --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/
```

For **testnet** use `--chain-id 10143`. For **mainnet** use `--chain-id 143` and the mainnet verifier URL if different.

---

## 3. Set the operator (backend must call contract)

The backend uses `OPERATOR_PRIVATE_KEY` to send transactions (createEpoch, endEpoch, setPendingRewardsBatch, etc.). The contract allows these only for the address set as **operator**. The **owner** (deployer) must call `setOperator(operatorAddress)` once.

**Derive the operator address from your backend operator key:**

```bash
# Operator address (from backend .env OPERATOR_PRIVATE_KEY)
cast wallet address --private-key $OPERATOR_PRIVATE_KEY
```

**Call setOperator as the owner (deployer):**

```bash
# Replace with your values
export MOLTI_ARENA_ADDRESS=0x...        # Deployed MoltiArena
export OPERATOR_ADDRESS=0x...          # From: cast wallet address --private-key <OPERATOR_PRIVATE_KEY>
export OWNER_PRIVATE_KEY=0x...         # Deployer key (same as PRIVATE_KEY in deploy .env)
export RPC_URL=https://testnet-rpc.monad.xyz

cast send $MOLTI_ARENA_ADDRESS "setOperator(address)" $OPERATOR_ADDRESS \
  --private-key $OWNER_PRIVATE_KEY \
  --rpc-url $RPC_URL
```

One-liner (fill in the three values):

```bash
cast send <MOLTI_ARENA_ADDRESS> "setOperator(address)" <OPERATOR_ADDRESS> --private-key <OWNER_PRIVATE_KEY> --rpc-url https://testnet-rpc.monad.xyz
```

Example:

```bash
cast send 0xf9593b960eBe723fad4E301499bd84CE3E06E383 "setOperator(address)" 0xYourOperatorAddress --private-key $OWNER_PRIVATE_KEY --rpc-url https://testnet-rpc.monad.xyz
```

After this, the backend (using `OPERATOR_PRIVATE_KEY`) can perform operator-only actions on the contract.

---

## Summary checklist

1. **Deploy:** `forge script script/Deploy.s.sol:Deploy --broadcast --verify` from `contract/moltiarena`.
2. **Verify** (if needed): `forge verify-contract ...` for MoltiToken and MoltiArena with correct constructor args and chain-id (10143 testnet).
3. **Backend .env:** Set `MOLTI_TOKEN_ADDRESS` and `MOLTI_ARENA_ADDRESS` to the deployed addresses.
4. **Set operator:** `cast send <MOLTI_ARENA_ADDRESS> "setOperator(address)" <OPERATOR_ADDRESS> --private-key <OWNER_PRIVATE_KEY> --rpc-url <RPC_URL>`.
5. **Backend .env:** Ensure `OPERATOR_PRIVATE_KEY` matches the address you set as operator.
