import { toast, type Id } from "react-toastify";
import { EXPLORER_URL } from "./contracts/abis";

/**
 * Toast utility helpers for transaction feedback.
 */

/** Show a success toast. */
export function toastSuccess(message: string): Id {
  return toast.success(message, { autoClose: 5000 });
}

/** Show an error toast. */
export function toastError(message: string): Id {
  return toast.error(message, { autoClose: 8000 });
}

/** Show an info toast. */
export function toastInfo(message: string): Id {
  return toast.info(message, { autoClose: 4000 });
}

/** Show a loading toast (returns an ID to update/dismiss later). */
export function toastPending(message: string): Id {
  return toast.loading(message);
}

/** Update a pending toast to success. */
export function toastUpdateSuccess(toastId: Id, message: string): void {
  toast.update(toastId, {
    render: message,
    type: "success",
    isLoading: false,
    autoClose: 5000,
  });
}

/** Update a pending toast to error. */
export function toastUpdateError(toastId: Id, message: string): void {
  toast.update(toastId, {
    render: message,
    type: "error",
    isLoading: false,
    autoClose: 8000,
  });
}

/** Dismiss a toast. */
export function toastDismiss(toastId: Id): void {
  toast.dismiss(toastId);
}

/**
 * Show a success toast with a clickable transaction link.
 * @param hash Transaction hash (0x...)
 * @param message Optional prefix message
 */
export function toastTx(hash: string, message = "Transaction confirmed"): Id {
  const shortHash = `${hash.slice(0, 8)}...${hash.slice(-6)}`;
  return toast.success(
    `${message} — ${shortHash}`,
    {
      autoClose: 8000,
      onClick: () => {
        window.open(`${EXPLORER_URL}/tx/${hash}`, "_blank");
      },
      style: { cursor: "pointer" },
    },
  );
}

/**
 * Extract a user-friendly error message from a transaction error.
 */
export function extractTxError(error: unknown): string {
  // Always log the full error for debugging
  console.error("[tx-error]", error);

  if (error instanceof Error) {
    const msg = error.message;
    // User rejected the request
    if (msg.includes("User rejected") || msg.includes("user rejected")) {
      return "Transaction rejected by user";
    }
    // Insufficient funds for gas
    if (msg.includes("insufficient funds")) {
      return "Insufficient funds for gas (need MON)";
    }
    // Contract revert with specific error
    if (msg.includes("execution reverted")) {
      // Try to extract revert reason
      const match = msg.match(/reason:\s*(.+?)(?:\n|$)/);
      if (match?.[1]) return `Reverted: ${match[1]}`;
      // Try to extract error name from the message
      const errorMatch = msg.match(/error\s+(\w+)\(/);
      if (errorMatch?.[1]) return `Reverted: ${errorMatch[1]}`;
      return "Transaction reverted by contract";
    }
    // Chain switching errors
    if (msg.includes("chain") || msg.includes("network")) {
      return `Network error: ${msg.split("\n")[0]?.slice(0, 100) ?? msg}`;
    }
    // ContractFunctionExecutionError — common with viem
    if (msg.includes("ContractFunctionExecutionError")) {
      const detailMatch = msg.match(/Details:\s*(.+?)(?:\n|$)/);
      if (detailMatch?.[1]) return detailMatch[1].slice(0, 120);
    }
    // Try shortMessage if available (viem errors have this)
    const errObj = error as Error & { shortMessage?: string; details?: string };
    if (errObj.shortMessage) {
      return errObj.shortMessage.slice(0, 150);
    }
    if (errObj.details) {
      return errObj.details.slice(0, 150);
    }
    // Return the first meaningful line
    const firstLine = msg.split("\n")[0] ?? msg;
    if (firstLine.length < 150) return firstLine;
    return firstLine.slice(0, 150) + "...";
  }
  return "An unknown error occurred";
}
