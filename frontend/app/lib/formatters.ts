/** Locale-formatted number with configurable decimal digits. Returns "--" for nullish. */
export function formatNum(n: number | null | undefined, digits = 2): string {
  if (n == null) return "--";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Rounded integer with German-locale thousands separator (dot). */
export function formatNumBrute(n: number | null | undefined): string {
  if (n == null) return "--";
  const rounded = Math.round(n);
  return rounded.toLocaleString("de-DE", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

/** Truncate a hex address/hash to "0xAbCd...1234" form. */
export function shortAddr(addr: string | null | undefined): string {
  if (!addr) return "???";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Human-readable short date: "Feb 15, 02:30". */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Convert a wei-denominated string to a number in token units (÷ 1e18). */
export function weiToMolti(wei: string): number {
  return Number(wei || "0") / 1e18;
}

/** Format large volume numbers compactly: 12345 → "12.3k", 0.5 → "0.50". */
export function formatVol(v: number | null): string {
  if (v == null) return "-";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(2);
}
