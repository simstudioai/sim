/** Default retry pacing: 500 ms floor, 30 s ceiling. */
const DEFAULT_BACKOFF_BASE_MS = 500
const DEFAULT_BACKOFF_MAX_MS = 30_000

export interface BackoffOptions {
  baseMs?: number
  maxMs?: number
}

/**
 * Computes the next delay for a retry loop.
 *
 * When `retryAfterMs` is non-null (from a `Retry-After` response header), the
 * value is clamped to `[baseMs, maxMs]` so a malformed `Retry-After: 0` cannot
 * pin the loop into a tight retry. Otherwise returns exponential backoff with
 * ±20% jitter to avoid thundering-herd alignment across concurrent callers.
 * Attempt is 1-indexed.
 */
export function backoffWithJitter(
  attempt: number,
  retryAfterMs: number | null,
  options: BackoffOptions = {}
): number {
  const baseMs = options.baseMs ?? DEFAULT_BACKOFF_BASE_MS
  const maxMs = options.maxMs ?? DEFAULT_BACKOFF_MAX_MS
  if (retryAfterMs !== null) {
    return Math.min(Math.max(retryAfterMs, baseMs), maxMs)
  }
  const exponential = Math.min(baseMs * 2 ** (attempt - 1), maxMs)
  // Inline crypto float to avoid cross-file imports within the package (Turbopack limitation)
  const jitter = crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000
  return exponential * (0.8 + jitter * 0.4)
}

/** Default maximum `Retry-After` value honored: 30 s. Prevents a misconfigured upstream from stalling callers. */
const RETRY_AFTER_MAX_MS = 30_000

/**
 * Parses an HTTP `Retry-After` header (either delta-seconds or an HTTP-date)
 * into a millisecond delay, capped at `maxMs` (default 30 s).
 * Returns `null` when the header is absent or unparseable so callers can fall
 * back to their own backoff. Pass the caller's own `maxDelayMs` as `maxMs` when
 * that value needs to be compared against the parsed delay (e.g. to decide
 * whether to skip a retry) — otherwise the default cap silently truncates the
 * comparison.
 */
export function parseRetryAfter(header: string | null, maxMs = RETRY_AFTER_MAX_MS): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (trimmed.length === 0) return null
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.floor(seconds * 1000), maxMs)
  }
  const dateMs = Date.parse(trimmed)
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now()
    if (delta <= 0) return 0
    return Math.min(delta, maxMs)
  }
  return null
}

/** Generous room for the healthy handshake that follows a recovered stall; a real one takes tens of milliseconds. */
const HEALTHY_HANDSHAKE_ALLOWANCE_MS = 1_000

export interface ColdConnectionBudgetOptions {
  /** The client's TCP connect deadline: bounds a connection that never completes at all. */
  connectTimeoutMs: number
  /** The client's per-command deadline: bounds a handshake command the server never answers. */
  commandTimeoutMs: number
  /** What the client's `retryStrategy` returns for its first reconnect. */
  reconnectDelayMs: number
}

/**
 * How long a wait for a cold connection must allow before giving up, if it is
 * to survive one dead attempt and still see a healthy one land.
 *
 * A dead attempt is diagnosed by whichever deadline governs the phase it
 * stalls in. A connect that never completes costs `connectTimeoutMs`. A
 * connection that opens but whose handshake is never answered costs command
 * deadlines: one when the URL carries a password, because ioredis treats a
 * timed-out `AUTH` as fatal and tears the socket down; two when it does not,
 * because `CLIENT SETNAME`/`SETINFO` must settle — by timing out — before the
 * `INFO` ready check even starts its own. The budget takes the largest of those
 * so it holds for either URL shape without parsing it. Only then does the
 * client's `retryStrategy` delay run and a fresh attempt begin.
 *
 * A wait sized to a single deadline expires while the first attempt is still
 * being diagnosed, so a configured retry can never be the thing that saves it.
 *
 * The guarantee is one dead attempt from a fresh or previously-ready client.
 * ioredis feeds `retryStrategy` its running attempt count, so a wait that
 * begins while the client is already deep in a reconnect loop faces larger
 * delays this does not model.
 */
export function coldConnectionBudgetMs(options: ColdConnectionBudgetOptions): number {
  const deadAttemptMs = Math.max(options.connectTimeoutMs, 2 * options.commandTimeoutMs)
  return deadAttemptMs + options.reconnectDelayMs + HEALTHY_HANDSHAKE_ALLOWANCE_MS
}
