/**
 * In-process sliding-window rate limiter for NAV write operations.
 *
 * Why this exists:
 *   manage_invoice and manage_annulment are destructive, non-idempotent operations
 *   that submit real invoices to the Hungarian tax authority. A buggy or looping
 *   LLM agent could flood NAV with submissions, triggering account suspension or
 *   unintended legal consequences. This limiter provides a last-resort safety net
 *   at the MCP server level, in addition to NAV's own server-side rate limits.
 *
 * Design:
 *   - Sliding window per operation name (separate counters for manage_invoice /
 *     manage_annulment so one cannot exhaust the other's quota)
 *   - State lives in module scope — resets on process restart, not persistent
 *   - Configurable via constructor, defaults are conservative
 */

export interface RateLimitConfig {
  /** Maximum calls allowed within the window */
  maxCalls: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Emit a warning (but still allow) when this threshold is reached */
  warnThreshold: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxCalls: 20,
  windowMs: 10 * 60 * 1000, // 10 minutes
  warnThreshold: 10,
};

export class RateLimiter {
  private readonly config: RateLimitConfig;
  /** operation name → sorted array of call timestamps */
  private readonly windows: Map<string, number[]> = new Map();

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a call attempt for the given operation.
   *
   * @returns An object describing whether the call is allowed and any warning.
   */
  check(operation: string): { allowed: boolean; warning?: string; callCount: number } {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Get or create the call history for this operation
    let timestamps = this.windows.get(operation) ?? [];

    // Purge entries outside the current window (sliding window)
    timestamps = timestamps.filter((t) => t > windowStart);

    const callCount = timestamps.length;

    if (callCount >= this.config.maxCalls) {
      // Oldest call still in window — calculate when the window will free up a slot
      const oldestInWindow = timestamps[0];
      const retryAfterMs = oldestInWindow + this.config.windowMs - now;
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);

      this.windows.set(operation, timestamps);
      return {
        allowed: false,
        warning: `Rate limit exceeded for "${operation}": ${callCount}/${this.config.maxCalls} calls in the last ${this.config.windowMs / 60_000} minutes. Retry after ${retryAfterSec}s.`,
        callCount,
      };
    }

    // Record this call
    timestamps.push(now);
    this.windows.set(operation, timestamps);
    const newCount = callCount + 1;

    // Warning threshold — allow the call but signal caution
    if (newCount >= this.config.warnThreshold) {
      return {
        allowed: true,
        warning:
          `⚠️ Rate limit warning for "${operation}": ${newCount}/${this.config.maxCalls} write operations used in this session window (${this.config.windowMs / 60_000} min). Approaching limit.`,
        callCount: newCount,
      };
    }

    return { allowed: true, callCount: newCount };
  }

  /** Returns current call counts (for diagnostics) */
  stats(): Record<string, number> {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const result: Record<string, number> = {};
    for (const [op, timestamps] of this.windows) {
      result[op] = timestamps.filter((t) => t > windowStart).length;
    }
    return result;
  }
}

/** Singleton instance shared across all tool calls in this process */
export const writeRateLimiter = new RateLimiter();
