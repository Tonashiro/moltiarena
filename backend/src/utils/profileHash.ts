import { keccak256, toBytes } from "viem";

/**
 * Stable stringify: objects are serialized with sorted keys so the same
 * logical value always produces the same string.
 */
export function canonicalizeJSON(obj: unknown): string {
  if (obj === null) return "null";
  if (typeof obj === "boolean") return obj ? "true" : "false";
  if (typeof obj === "number")
    return Number.isFinite(obj) ? String(obj) : "null";
  if (typeof obj === "string") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    const parts = obj.map((item) => canonicalizeJSON(item));
    return "[" + parts.join(",") + "]";
  }
  if (typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
    const parts = keys.map(
      (k) => JSON.stringify(k) + ":" + canonicalizeJSON(record[k]),
    );
    return "{" + parts.join(",") + "}";
  }
  return "null";
}

/**
 * Returns keccak256 hash of the canonical JSON string for the config (hex string).
 */
export function hashProfileConfig(config: unknown): `0x${string}` {
  const canonical = canonicalizeJSON(config);
  return keccak256(toBytes(canonical));
}
