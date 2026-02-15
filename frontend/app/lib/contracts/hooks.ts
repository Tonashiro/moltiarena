"use client";

/**
 * Custom hooks for interacting with MoltiArena smart contracts.
 * Wraps wagmi's useWriteContract + useWaitForTransactionReceipt.
 * All calls explicitly target monadTestnet.id to avoid sending tx to wrong chain.
 */
import { useCallback, useState } from "react";
import {
  useReadContract,
  useWriteContract,
  useAccount,
  useSwitchChain,
  useChainId,
  useBalance,
  useSendTransaction,
} from "wagmi";
import { type Hex, parseEther } from "viem";
import { monadTestnet } from "../../wagmi/config";
import {
  MOLTI_TOKEN_ABI,
  MOLTI_TOKEN_ADDRESS,
  MOLTI_ARENA_ABI,
  MOLTI_ARENA_ADDRESS,
} from "./abis";
import {
  toastPending,
  toastUpdateSuccess,
  toastUpdateError,
  toastTx,
  toastError,
  extractTxError,
} from "../toast";

const CHAIN_ID = monadTestnet.id;

// ─── Read hooks ──────────────────────────────────────────────────────

/** Read the agent creation fee from the contract. */
export function useAgentCreationFee() {
  return useReadContract({
    address: MOLTI_ARENA_ADDRESS,
    abi: MOLTI_ARENA_ABI,
    functionName: "agentCreationFee",
    chainId: CHAIN_ID,
  });
}

/** Read the user's MOLTI balance. */
export function useMoltiBalance(address: `0x${string}` | undefined) {
  return useReadContract({
    address: MOLTI_TOKEN_ADDRESS,
    abi: MOLTI_TOKEN_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  });
}

/** Read MOLTI balance for any address (e.g. agent smart account). */
export function useSmartAccountMoltiBalance(address: string | null | undefined) {
  const addr = address as `0x${string}` | undefined;
  return useReadContract({
    address: MOLTI_TOKEN_ADDRESS,
    abi: MOLTI_TOKEN_ABI,
    functionName: "balanceOf",
    args: addr ? [addr] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!addr, refetchInterval: 30_000 },
  });
}

/** Read native MON balance for any address (e.g. agent smart account). */
export function useMonBalance(address: string | null | undefined) {
  const addr = address as `0x${string}` | undefined;
  return useBalance({
    address: addr,
    chainId: CHAIN_ID,
    query: { enabled: !!addr, refetchInterval: 30_000 },
  });
}

/** Read the contract owner address. */
export function useContractOwner() {
  return useReadContract({
    address: MOLTI_ARENA_ADDRESS,
    abi: MOLTI_ARENA_ABI,
    functionName: "owner",
    chainId: CHAIN_ID,
  });
}

/** Read the current allowance for MoltiArena to spend user's MOLTI. */
export function useMoltiAllowance(owner: `0x${string}` | undefined) {
  return useReadContract({
    address: MOLTI_TOKEN_ADDRESS,
    abi: MOLTI_TOKEN_ABI,
    functionName: "allowance",
    args: owner ? [owner, MOLTI_ARENA_ADDRESS] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!owner },
  });
}

// ─── Write hooks ─────────────────────────────────────────────────────

export type TxStatus = "idle" | "approving" | "confirming-approval" | "writing" | "confirming" | "success" | "error";

/**
 * Hook to approve MOLTI tokens and then call createAgent on the contract.
 * Returns a function that handles the full flow with toast notifications.
 */
export function useCreateAgentOnChain() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const chainId = useChainId();
  const [status, setStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<Hex | undefined>();
  const [agentId, setAgentId] = useState<bigint | undefined>();

  const createAgent = useCallback(
    async (profileHash: `0x${string}`, walletAddress: `0x${string}`, creationFee: bigint) => {
      if (!address) {
        toastError("Connect your wallet first");
        return null;
      }

      setStatus("idle");
      setTxHash(undefined);
      setAgentId(undefined);

      // Ensure wallet is on Monad Testnet
      if (chainId !== CHAIN_ID) {
        try {
          await switchChainAsync({ chainId: CHAIN_ID });
        } catch (err) {
          toastError("Please switch to Monad Testnet to continue");
          return null;
        }
      }

      // Step 1: Approve MOLTI
      const approvalToast = toastPending("Approving MOLTI tokens...");
      try {
        setStatus("approving");
        const approveHash = await writeContractAsync({
          address: MOLTI_TOKEN_ADDRESS,
          abi: MOLTI_TOKEN_ABI,
          functionName: "approve",
          args: [MOLTI_ARENA_ADDRESS, creationFee],
          chainId: CHAIN_ID,
        });

        setStatus("confirming-approval");
        toastUpdateSuccess(approvalToast, "Approval submitted, waiting for confirmation...");

        // Wait for approval confirmation
        const { waitForTransactionReceipt } = await import("wagmi/actions");
        const { config } = await import("../../wagmi/config");
        await waitForTransactionReceipt(config, {
          hash: approveHash,
          confirmations: 1,
        });

        toastUpdateSuccess(approvalToast, "MOLTI approved!");
      } catch (err) {
        setStatus("error");
        toastUpdateError(approvalToast, extractTxError(err));
        return null;
      }

      // Step 2: Create Agent on-chain
      const createToast = toastPending("Creating agent on-chain...");
      try {
        setStatus("writing");
        const hash = await writeContractAsync({
          address: MOLTI_ARENA_ADDRESS,
          abi: MOLTI_ARENA_ABI,
          functionName: "createAgent",
          args: [profileHash, walletAddress],
          chainId: CHAIN_ID,
        });

        setTxHash(hash);
        setStatus("confirming");
        toastUpdateSuccess(createToast, "Transaction submitted, waiting for confirmation...");

        // Wait for confirmation and get agent ID from logs
        const { waitForTransactionReceipt } = await import("wagmi/actions");
        const { config } = await import("../../wagmi/config");
        const receipt = await waitForTransactionReceipt(config, {
          hash,
          confirmations: 1,
        });

        // Parse AgentCreated event from receipt to get the agentId
        let createdAgentId: bigint | undefined;
        if (receipt.logs.length > 0) {
          const { decodeEventLog } = await import("viem");
          for (const log of receipt.logs) {
            try {
              const decoded = decodeEventLog({
                abi: MOLTI_ARENA_ABI,
                data: log.data,
                topics: log.topics,
              });
              if (decoded.eventName === "AgentCreated") {
                const args = decoded.args as { agentId: bigint };
                createdAgentId = args.agentId;
                break;
              }
            } catch {
              // Not our event — skip
            }
          }
        }

        setAgentId(createdAgentId);
        setStatus("success");
        toastUpdateSuccess(createToast, "Agent created on-chain!");
        toastTx(hash, "Agent created");

        return {
          txHash: hash,
          agentId: createdAgentId ? Number(createdAgentId) : undefined,
        };
      } catch (err) {
        setStatus("error");
        toastUpdateError(createToast, extractTxError(err));
        return null;
      }
    },
    [address, writeContractAsync, switchChainAsync, chainId],
  );

  return {
    createAgent,
    status,
    txHash,
    agentId,
    isLoading: status !== "idle" && status !== "success" && status !== "error",
  };
}

/**
 * Hook to approve MOLTI tokens and register an agent to an arena.
 */
export function useRegisterToArenaOnChain() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const chainId = useChainId();
  const [status, setStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<Hex | undefined>();

  const register = useCallback(
    async (onChainAgentId: bigint, onChainArenaId: bigint, depositMolti: bigint) => {
      if (!address) {
        toastError("Connect your wallet first");
        return null;
      }

      setStatus("idle");
      setTxHash(undefined);

      // Ensure wallet is on Monad Testnet
      if (chainId !== CHAIN_ID) {
        try {
          await switchChainAsync({ chainId: CHAIN_ID });
        } catch (err) {
          toastError("Please switch to Monad Testnet to continue");
          return null;
        }
      }

      // Step 1: Approve MOLTI for registration (skip when deposit is 0)
      if (depositMolti > BigInt(0)) {
        const approvalToast = toastPending("Approving registration...");
        try {
          setStatus("approving");
          const approveHash = await writeContractAsync({
            address: MOLTI_TOKEN_ADDRESS,
            abi: MOLTI_TOKEN_ABI,
            functionName: "approve",
            args: [MOLTI_ARENA_ADDRESS, depositMolti],
            chainId: CHAIN_ID,
          });

          setStatus("confirming-approval");
          toastUpdateSuccess(approvalToast, "Approval submitted...");

          const { waitForTransactionReceipt } = await import("wagmi/actions");
          const { config } = await import("../../wagmi/config");
          await waitForTransactionReceipt(config, {
            hash: approveHash,
            confirmations: 1,
          });

          toastUpdateSuccess(approvalToast, "Approved!");
        } catch (err) {
          setStatus("error");
          toastUpdateError(approvalToast, extractTxError(err));
          return null;
        }
      }

      // Step 2: Register to arena
      const registerToast = toastPending("Registering to arena...");
      try {
        setStatus("writing");
        const hash = await writeContractAsync({
          address: MOLTI_ARENA_ADDRESS,
          abi: MOLTI_ARENA_ABI,
          functionName: "registerToArena",
          args: [onChainAgentId, onChainArenaId, depositMolti],
          chainId: CHAIN_ID,
        });

        setTxHash(hash);
        setStatus("confirming");
        toastUpdateSuccess(registerToast, "Transaction submitted...");

        const { waitForTransactionReceipt } = await import("wagmi/actions");
        const { config } = await import("../../wagmi/config");
        await waitForTransactionReceipt(config, {
          hash,
          confirmations: 1,
        });

        setStatus("success");
        toastUpdateSuccess(registerToast, "Registered to arena!");
        toastTx(hash, "Registration confirmed");

        return { txHash: hash };
      } catch (err) {
        setStatus("error");
        toastUpdateError(registerToast, extractTxError(err));
        return null;
      }
    },
    [address, writeContractAsync, switchChainAsync, chainId],
  );

  return {
    register,
    status,
    txHash,
    isLoading: status !== "idle" && status !== "success" && status !== "error",
  };
}

/**
 * Hook for contract owner to create an arena on-chain.
 * This links the off-chain seeded arena to the smart contract.
 */
export function useCreateArenaOnChain() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const chainId = useChainId();
  const [isLoading, setIsLoading] = useState(false);

  const createArena = useCallback(
    async (tokenAddress: `0x${string}`, name: string) => {
      if (!address) {
        toastError("Connect your wallet first");
        return null;
      }

      // Ensure wallet is on Monad Testnet
      if (chainId !== CHAIN_ID) {
        try {
          await switchChainAsync({ chainId: CHAIN_ID });
        } catch {
          toastError("Please switch to Monad Testnet to continue");
          return null;
        }
      }

      const pendingToast = toastPending("Creating arena on-chain...");
      setIsLoading(true);

      try {
        const hash = await writeContractAsync({
          address: MOLTI_ARENA_ADDRESS,
          abi: MOLTI_ARENA_ABI,
          functionName: "createArena",
          args: [tokenAddress, name],
          chainId: CHAIN_ID,
        });

        toastUpdateSuccess(pendingToast, "Transaction submitted...");

        const { waitForTransactionReceipt } = await import("wagmi/actions");
        const { config } = await import("../../wagmi/config");
        await waitForTransactionReceipt(config, {
          hash,
          confirmations: 1,
        });

        setIsLoading(false);
        toastUpdateSuccess(pendingToast, "Arena created on-chain!");
        toastTx(hash, "Arena activation confirmed");

        return { txHash: hash };
      } catch (err) {
        setIsLoading(false);
        toastUpdateError(pendingToast, extractTxError(err));
        return null;
      }
    },
    [address, writeContractAsync, switchChainAsync, chainId],
  );

  return { createArena, isLoading };
}

/**
 * Hook to fund an agent's wallet by transferring MOLTI tokens.
 * Sends an ERC20 transfer to the agent's wallet address, then records it on the backend.
 */
export function useFundAgent() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const chainId = useChainId();
  const [status, setStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<Hex | undefined>();

  const fund = useCallback(
    async (agentWallet: `0x${string}`, amountMolti: string) => {
      if (!address) {
        toastError("Connect your wallet first");
        return null;
      }

      const amountWei = parseEther(amountMolti);
      if (amountWei <= BigInt(0)) {
        toastError("Amount must be greater than 0");
        return null;
      }

      setStatus("idle");
      setTxHash(undefined);

      // Ensure wallet is on Monad Testnet
      if (chainId !== CHAIN_ID) {
        try {
          await switchChainAsync({ chainId: CHAIN_ID });
        } catch {
          toastError("Please switch to Monad Testnet to continue");
          return null;
        }
      }

      const pendingToast = toastPending("Transferring MOLTI to agent wallet...");
      try {
        setStatus("writing");
        const hash = await writeContractAsync({
          address: MOLTI_TOKEN_ADDRESS,
          abi: MOLTI_TOKEN_ABI,
          functionName: "transfer",
          args: [agentWallet, amountWei],
          chainId: CHAIN_ID,
        });

        setTxHash(hash);
        setStatus("confirming");
        toastUpdateSuccess(pendingToast, "Transfer submitted...");

        const { waitForTransactionReceipt } = await import("wagmi/actions");
        const { config } = await import("../../wagmi/config");
        await waitForTransactionReceipt(config, {
          hash,
          confirmations: 1,
        });

        setStatus("success");
        const amountDisplay = Number(amountMolti).toLocaleString();
        toastUpdateSuccess(
          pendingToast,
          `Sent ${amountDisplay} MOLTI to agent wallet!`,
        );
        toastTx(hash, "Funding confirmed");

        return {
          txHash: hash,
          amount: Number(amountMolti),
        };
      } catch (err) {
        setStatus("error");
        toastUpdateError(pendingToast, extractTxError(err));
        return null;
      }
    },
    [address, writeContractAsync, switchChainAsync, chainId],
  );

  return {
    fund,
    status,
    txHash,
    isLoading: status !== "idle" && status !== "success" && status !== "error",
  };
}

/**
 * Fund agent wallet with native MON (simple ETH/MON transfer).
 */
export function useFundAgentMon() {
  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const chainId = useChainId();
  const [status, setStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<Hex | undefined>();

  const fund = useCallback(
    async (agentWallet: `0x${string}`, amountMon: string) => {
      if (!address) {
        toastError("Connect your wallet first");
        return null;
      }

      const amountWei = parseEther(amountMon);
      if (amountWei <= BigInt(0)) {
        toastError("Amount must be greater than 0");
        return null;
      }

      setStatus("idle");
      setTxHash(undefined);

      if (chainId !== CHAIN_ID) {
        try {
          await switchChainAsync({ chainId: CHAIN_ID });
        } catch {
          toastError("Please switch to Monad Testnet to continue");
          return null;
        }
      }

      const pendingToast = toastPending("Sending MON to agent wallet...");
      try {
        setStatus("writing");
        const hash = await sendTransactionAsync({
          to: agentWallet,
          value: amountWei,
          chainId: CHAIN_ID,
        });

        setTxHash(hash);
        setStatus("confirming");
        toastUpdateSuccess(pendingToast, "MON transfer submitted...");

        const { waitForTransactionReceipt } = await import("wagmi/actions");
        const { config } = await import("../../wagmi/config");
        await waitForTransactionReceipt(config, {
          hash,
          confirmations: 1,
        });

        setStatus("success");
        const amountDisplay = Number(amountMon).toLocaleString();
        toastUpdateSuccess(
          pendingToast,
          `Sent ${amountDisplay} MON to agent wallet!`,
        );
        toastTx(hash, "MON funding confirmed");

        return {
          txHash: hash,
          amount: Number(amountMon),
        };
      } catch (err) {
        setStatus("error");
        toastUpdateError(pendingToast, extractTxError(err));
        return null;
      }
    },
    [address, sendTransactionAsync, switchChainAsync, chainId],
  );

  return {
    fund,
    status,
    txHash,
    isLoading: status !== "idle" && status !== "success" && status !== "error",
  };
}
