import { isAddress } from "viem";

/**
 * Validates Ethereum address format.
 */
export function isValidAddress(address: string): boolean {
  try {
    return isAddress(address);
  } catch {
    return false;
  }
}

/**
 * Sanitizes string to prevent injection attacks.
 * Removes control characters and limits length.
 */
export function sanitizeString(input: string, maxLength: number = 1000): string {
  if (typeof input !== "string") {
    return "";
  }
  // Remove control characters except newlines and tabs
  let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // Limit length
  sanitized = sanitized.slice(0, maxLength);
  return sanitized.trim();
}

/**
 * Validates and normalizes token address.
 */
export function normalizeTokenAddress(address: string): string | null {
  if (!address || typeof address !== "string") {
    return null;
  }
  const normalized = address.toLowerCase().trim();
  if (!isValidAddress(normalized)) {
    return null;
  }
  return normalized;
}

/**
 * Validates transaction hash format (32-byte hex string).
 * Transaction hashes are 0x followed by 64 hex characters.
 */
export function normalizeTransactionHash(hash: string): string | null {
  if (!hash || typeof hash !== "string") {
    return null;
  }
  const normalized = hash.toLowerCase().trim();
  
  // Transaction hash format: 0x followed by exactly 64 hex characters
  if (!/^0x[a-f0-9]{64}$/.test(normalized)) {
    return null;
  }
  
  return normalized;
}

/**
 * Validates numeric values are finite and within bounds.
 */
export function validateNumber(
  value: unknown,
  min?: number,
  max?: number
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (min !== undefined && value < min) {
    return null;
  }
  if (max !== undefined && value > max) {
    return null;
  }
  return value;
}
