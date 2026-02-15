interface TokenInfo {
  name: string;
  image: string;
}

const TOKEN_INFO: Record<string, TokenInfo> = {
  "0x350035555E10d9AfAF1566AaebfCeD5BA6C27777": {
    name: "CHOG",
    image:
      "https://storage.nadapp.net/cdn-cgi/image/width=300,height=300,fit=cover,quality=75,format=auto/coin/e0489adc-c3a1-425c-9219-f1e344aa866a",
  },
  "0x42a4aA89864A794dE135B23C6a8D2E05513d7777": {
    name: "SHRAMP",
    image:
      "https://storage.nadapp.net/cdn-cgi/image/width=300,height=300,fit=cover,quality=75,format=auto/coin/31baf062-de2e-4f82-a3ec-2c6fa4981e4f",
  },
  "0x405b6330e213DED490240CbcDD64790806827777": {
    name: "MONCOCK",
    image:
      "https://storage.nadapp.net/cdn-cgi/image/width=300,height=300,fit=cover,quality=75,format=auto/coin/76a58f0d-02db-4800-845f-79b842b912c9",
  },
};

/**
 * Get token info (name + image) by address (case-insensitive).
 * Returns null if the token is not known.
 */
export function getTokenInfo(address: string): TokenInfo | null {
  const normalized = address.toLowerCase();
  for (const [addr, info] of Object.entries(TOKEN_INFO)) {
    if (addr.toLowerCase() === normalized) {
      return info;
    }
  }
  return null;
}

/**
 * Get token display name by address (case-insensitive).
 * Returns a shortened address if not found.
 */
export function getTokenName(address: string): string {
  return getTokenInfo(address)?.name ?? `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Get token image URL by address (case-insensitive).
 * Returns null if not found.
 */
export function getTokenImage(address: string): string | null {
  return getTokenInfo(address)?.image ?? null;
}
