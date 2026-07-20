import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  createPinnedFetch,
  createPinnedFetchWithDispatcher,
} from '@/lib/core/security/input-validation.server'
import { validateMcpServerSsrf } from '@/lib/mcp/domain-check'
import { McpError } from '@/lib/mcp/types'

/** Pinned fetch for the live MCP transport, plus a handle to release its sockets. */
export interface PinnedMcpFetch {
  /** Pinned fetch to hand to the MCP transport's `fetch` option. */
  fetch: typeof fetch
  /** Tears down the underlying HTTP/2 Agent; call when the MCP client disconnects. */
  close: () => Promise<void>
}

/**
 * Pinned fetch for the long-lived MCP transport, which reuses one Agent across
 * a connection's requests. MCP servers are commonly behind HTTP/2 fronts (CDNs,
 * cloud LBs), and undici's Agent is h1.1-only unless opted into h2 via ALPN, so
 * the transport enables it. h2 is *not* used for one-shot flows (OAuth discovery,
 * auth-type probe), where a per-request Agent would leave idle h2 sessions with
 * no reuse benefit. Pinning is unaffected: the pinned lookup forces the socket to
 * `resolvedIP` regardless of negotiated protocol. The returned `close` binds the
 * Agent's teardown to the transport lifecycle so h2 sessions don't linger past
 * disconnect.
 */
export function createPinnedMcpFetch(resolvedIP: string): PinnedMcpFetch {
  const { fetch: pinnedFetch, dispatcher } = createPinnedFetchWithDispatcher(resolvedIP, {
    allowH2: true,
  })
  return { fetch: pinnedFetch, close: () => dispatcher.destroy() }
}

/**
 * Per-request deadline for guarded MCP OAuth / RFC 7009 revocation HTTP calls.
 *
 * The MCP SDK issues OAuth discovery, dynamic client registration, and token
 * exchange with a bare `fetch` and no `AbortSignal` — only the JSON-RPC message
 * layer gets the SDK's request timeout. Combined with undici's 5-minute default
 * headers/body timeouts, a slow or unresponsive authorization server leaves the
 * request (and the browser the user is waiting on during `/oauth/start`) pending
 * for minutes. Bounding each leg turns that into a fast, actionable failure. 30s
 * mirrors `MCP_CLIENT_CONSTANTS.DEFAULT_CONNECTION_TIMEOUT` and leaves wide
 * headroom over a healthy server, which completes each leg in well under a second.
 */
const OAUTH_FETCH_TIMEOUT_MS = 30_000

/**
 * Awaits `promise` but rejects with the signal's reason if `signal` aborts first.
 * Bounds `dns.lookup`-based SSRF validation (which accepts no signal) by the
 * composed deadline + caller signal. Removes the abort listener once `promise`
 * settles so a late abort can't surface as an unhandled rejection.
 */
function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The promise is already in flight; adopt its settlement so a later rejection
    // (SSRF/DNS failure) can't surface as an unhandled rejection once we've aborted.
    promise.catch(() => {})
    return Promise.reject(signal.reason)
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

/**
 * Builds a `FetchLike` that validates every outbound request URL against the
 * MCP SSRF policy before issuing it, then pins the connection to the resolved
 * IP. Unlike the live transport — where the server URL is validated once up
 * front — OAuth discovery and RFC 7009 revocation follow URLs taken verbatim
 * from attacker-controllable authorization-server metadata
 * (`authorization_servers`, `token_endpoint`, `revocation_endpoint`, …). Each
 * such hop must be re-validated, so this guard runs `validateMcpServerSsrf`
 * per request and rejects private/reserved/loopback targets (honoring
 * `ALLOWED_MCP_DOMAINS` and self-hosted localhost rules).
 *
 * Each request is bounded by a `timeoutMs` deadline via `AbortSignal.timeout`,
 * composed with any caller-provided signal so cancellation still works. Only our
 * own deadline is relabeled to an `McpError`; a caller abort or any other failure
 * propagates unchanged.
 *
 * Both the deadline and any caller-provided signal cover the whole guarded call —
 * SSRF validation (whose `dns.lookup` takes no signal, so it's raced against the
 * composed signal) and the HTTP request — so a caller awaiting this never waits
 * past `timeoutMs` and can cancel at any point, including mid-validation. A
 * stalled DNS resolution still runs to completion in the background, but its
 * result is discarded.
 *
 * @param timeoutMs Per-request deadline in ms (defaults to 30s; override for tests).
 * @throws McpSsrfError if a request URL resolves to a blocked IP address
 * @throws McpError if a request exceeds `timeoutMs`
 */
export function createSsrfGuardedMcpFetch(timeoutMs: number = OAUTH_FETCH_TIMEOUT_MS): FetchLike {
  return (async (url, init) => {
    const target = typeof url === 'string' ? url : url.href
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    // Compose deadline + caller signal up front so both phases — SSRF validation
    // and the HTTP request — are bounded by the deadline and caller cancellation.
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
    try {
      const resolvedIP = await raceWithSignal(validateMcpServerSsrf(target), signal)
      const pinnedFetch: FetchLike = resolvedIP ? createPinnedFetch(resolvedIP) : globalThis.fetch
      return await pinnedFetch(url, { ...init, signal })
    } catch (error) {
      // Relabel only when our own deadline is what fired — identified by the
      // rejection reason's identity, not init.signal's state (which may abort
      // independently just after the deadline).
      if (timeoutSignal.aborted && error === timeoutSignal.reason) {
        const host = URL.canParse(target) ? new URL(target).host : target
        throw new McpError(`MCP authorization request to ${host} timed out after ${timeoutMs}ms`)
      }
      throw error
    }
  }) satisfies FetchLike
}
