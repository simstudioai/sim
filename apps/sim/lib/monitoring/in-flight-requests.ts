/**
 * Process-wide registry of route handlers currently running, plus a short ring
 * of recently settled ones, so an event-loop stall can list the requests that
 * were in flight while it happened.
 *
 * State lives on `globalThis`: Next instantiates this file once in the
 * instrumentation graph and again in each app-route graph, and module-level
 * state would leave the telemetry reader looking at an empty copy.
 *
 * What it can and cannot see:
 * - An entry settles when the handler returns its `Response` (headers), not
 *   when a streamed body finishes, so work done while streaming is never
 *   attributed. Page renders, server actions, and background loops are not
 *   tracked at all.
 * - The list is concurrency context, not a culprit: a long-poll or SSE handshake
 *   that merely waited through a stall appears alongside the request that
 *   caused it.
 * - Entries are keyed by a per-call token, so nested wrappers that share a
 *   request id each keep their own entry (and each count toward `inFlight`).
 * - A handler that never settles keeps its entry until the registry holds
 *   {@link MAX_TRACKED_IN_FLIGHT} entries; the oldest are then dropped and
 *   counted in {@link InFlightWindow.dropped}.
 *
 * Paths are already present on every route log line, so naming them here
 * widens no exposure.
 */

interface TrackedRequest {
  requestId: string
  method: string
  path: string
  startedAt: number
  endedAt?: number
}

/** A request that was in flight for the whole of a stall window. */
interface RequestSpanningStall {
  requestId: string
  method: string
  path: string
  /** How long the request had been running when the stall ended. */
  ageMs: number
  /** True when it settled at (or within the tolerance before) the end of the stall. */
  finished: boolean
}

/** Per-snapshot-window counters, reset by {@link takeInFlightWindow}. */
interface InFlightWindow {
  /** Highest concurrent in-flight count during the window. */
  peak: number
  /** Entries evicted because the registry was full (handlers that never settled). */
  dropped: number
}

interface InFlightState {
  live: Map<number, TrackedRequest>
  recent: (TrackedRequest | undefined)[]
  recentNext: number
  nextToken: number
  peak: number
  dropped: number
}

const MAX_TRACKED_IN_FLIGHT = 4_096
const RECENT_CAPACITY = 64
const MAX_SPANNING_RESULTS = 5
/**
 * Slack applied at both edges of a stall window. The probe timer runs some
 * milliseconds after the burst that freed the loop settled its own request, and
 * a request can start a few milliseconds after the probe was due (other
 * callbacks ran first) and then block. Requests queued behind the stall start
 * at its end, a full second or more later, so they stay out.
 */
const STALL_EDGE_TOLERANCE_MS = 50

const g = globalThis as typeof globalThis & { _simInFlightRequestState?: InFlightState }
if (!g._simInFlightRequestState) {
  g._simInFlightRequestState = {
    live: new Map(),
    recent: new Array(RECENT_CAPACITY),
    recentNext: 0,
    nextToken: 0,
    peak: 0,
    dropped: 0,
  }
}
const state = g._simInFlightRequestState

/**
 * Registers a running route handler. Call the returned function once when the
 * handler settles; later calls are no-ops.
 */
export function trackInFlightRequest(requestId: string, method: string, path: string): () => void {
  const token = state.nextToken++
  const entry: TrackedRequest = { requestId, method, path, startedAt: performance.now() }
  state.live.set(token, entry)
  if (state.live.size > MAX_TRACKED_IN_FLIGHT) {
    const oldest = state.live.keys().next().value
    if (oldest !== undefined) state.live.delete(oldest)
    state.dropped++
  }
  if (state.live.size > state.peak) state.peak = state.live.size
  return () => {
    if (!state.live.delete(token)) return
    entry.endedAt = performance.now()
    state.recent[state.recentNext] = entry
    state.recentNext = (state.recentNext + 1) % RECENT_CAPACITY
  }
}

/** Number of route handlers currently registered as running. */
export function getInFlightCount(): number {
  return state.live.size
}

/** Returns the window's counters and starts a new window (peak restarts at the current count). */
export function takeInFlightWindow(): InFlightWindow {
  const window = { peak: state.peak, dropped: state.dropped }
  state.peak = state.live.size
  state.dropped = 0
  return window
}

/**
 * Requests in flight for the whole stall window: started before it began and
 * still running, or settled by its end, each edge widened by
 * {@link STALL_EDGE_TOLERANCE_MS}. `stallStart` is when the probe was due.
 * Settled ones come first (the likeliest source of a synchronous burst), then
 * longest-running first. Concurrency context only; see the module TSDoc.
 */
export function findRequestsSpanningStall(
  stallStart: number,
  stallEnd: number
): RequestSpanningStall[] {
  const spansStall = (entry: TrackedRequest) =>
    entry.startedAt <= stallStart + STALL_EDGE_TOLERANCE_MS &&
    (entry.endedAt ?? stallEnd) >= stallEnd - STALL_EDGE_TOLERANCE_MS
  const matches: TrackedRequest[] = []
  for (const entry of state.live.values()) if (spansStall(entry)) matches.push(entry)
  for (const entry of state.recent) if (entry && spansStall(entry)) matches.push(entry)
  matches.sort(
    (a, b) =>
      Number(b.endedAt !== undefined) - Number(a.endedAt !== undefined) || a.startedAt - b.startedAt
  )
  return matches.slice(0, MAX_SPANNING_RESULTS).map((entry) => ({
    requestId: entry.requestId,
    method: entry.method,
    path: entry.path,
    ageMs: Math.round(stallEnd - entry.startedAt),
    finished: entry.endedAt !== undefined,
  }))
}
