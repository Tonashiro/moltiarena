/**
 * Token address to name mapping for arena tokens.
 * Used for logging and display purposes.
 */
export const TOKEN_NAMES: Record<string, string> = {
  "0x350035555E10d9AfAF1566AaebfCeD5BA6C27777": "Chog",
  "0x42a4aA89864A794dE135B23C6a8D2E05513d7777": "shramp",
  "0x405b6330e213DED490240CbcDD64790806827777": "moncock",
};

/**
 * Get token name by address (case-insensitive).
 * Returns the address if name not found.
 */
export function getTokenName(address: string): string {
  const normalized = address.toLowerCase();
  for (const [addr, name] of Object.entries(TOKEN_NAMES)) {
    if (addr.toLowerCase() === normalized) {
      return name;
    }
  }
  return address;
}

/**
 * Get all token addresses that have names.
 */
export function getKnownTokenAddresses(): string[] {
  return Object.keys(TOKEN_NAMES);
}
