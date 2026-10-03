/** Generous room for the healthy handshake that follows a recovered stall; a real one takes tens of milliseconds. */
const HEALTHY_HANDSHAKE_ALLOWANCE_MS = 1_000

export interface ColdConnectionBudgetOptions {
  /** The client's TCP connect deadline: bounds a connection that never completes at all. */
  connectTimeoutMs: number
  /** The client's per-command deadline: bounds a handshake command the server never answers. */
  commandTimeoutMs: number
  /** How long ioredis waits after half-closing a dead socket for the peer's FIN before destroying it. */
  disconnectTimeoutMs: number
  /** What the client's `retryStrategy` returns for its first reconnect. */
  reconnectDelayMs: number
}

/**
 * How long a wait for a cold ioredis connection must allow before giving up,
 * if it is to survive one dead attempt and still see a healthy one land.
 *
 * A dead attempt is diagnosed by whichever deadline governs the phase it
 * stalls in. A connect that never completes costs `connectTimeoutMs`, and the
 * socket is destroyed outright. A connection that opens but whose handshake
 * is never answered costs command deadlines — one with a password, because a
 * timed-out `AUTH` is fatal; two without, because `CLIENT SETNAME`/`SETINFO`
 * must settle, by timing out, before the `INFO` ready check starts its own —
 * and then `disconnectTimeoutMs` more, because ioredis half-closes the socket
 * and a peer that is wedged never answers with a FIN. The budget takes the
 * larger phase so it holds for either URL shape without parsing it. Only then
 * does `retryStrategy` run and a fresh attempt begin.
 *
 * A wait sized to a single deadline expires while the first attempt is still
 * being diagnosed, so a configured retry can never be the thing that saves it.
 *
 * The guarantee is one dead attempt from a fresh or previously-ready client.
 * ioredis feeds `retryStrategy` its running attempt count, so a wait that
 * begins while the client is already deep in a reconnect loop faces larger
 * delays this does not model. The handshake sequence is ioredis 5's; keep this
 * beside the pinned client, not in a generic package.
 */
export function coldConnectionBudgetMs(options: ColdConnectionBudgetOptions): number {
  const deadAttemptMs = Math.max(
    options.connectTimeoutMs,
    2 * options.commandTimeoutMs + options.disconnectTimeoutMs
  )
  return deadAttemptMs + options.reconnectDelayMs + HEALTHY_HANDSHAKE_ALLOWANCE_MS
}
