/**
 * Shared formatting utilities used across UI components and pixi sprites.
 */

/**
 * Format a token count as a human-readable string.
 *
 * - < 1,000        → plain number, e.g. "42"
 * - 1K – 999K      → one decimal K, e.g. "12.3K"
 * - ≥ 1M           → configurable decimal M, e.g. "1.23M" (default) or "1.2M"
 *
 * @param n          Raw token count
 * @param mPrecision Decimal places for the M suffix (default 2; pass 1 for SessionStats)
 */
export function formatTokens(n: number, mPrecision = 2): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(mPrecision)}M`;
}

/**
 * Format a Unix-ms timestamp as a human-readable relative or absolute time.
 *
 * - < 1 minute ago  → "just now"
 * - < 60 minutes ago → "Xm ago"
 * - older           → locale time string, e.g. "02:45 PM"
 */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Extract the final path component from a file path, handling both `/` and `\`
 * separators (Unix and Windows paths).
 *
 * Returns the original string if it is empty or contains no separator.
 */
export function basename(path: string): string {
  if (!path) return path;
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? path;
}
