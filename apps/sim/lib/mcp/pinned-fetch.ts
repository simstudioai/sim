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
 * Note: the deadline only bounds the HTTP request, not the validation DNS lookup
 * — Node's `dns.lookup` does not accept a signal, so a hanging resolution can
 * extend the overall call by up to the OS DNS timeout. Acceptable here because
 * all consumers are best-effort authorization/revocation flows.
 *
 * @param timeoutMs Per-request deadline in ms (defaults to 30s; override for tests).
 * @throws McpSsrfError if a request URL resolves to a blocked IP address
 * @throws McpError if a request exceeds `timeoutMs`
 */
export function createSsrfGuardedMcpFetch(timeoutMs: number = OAUTH_FETCH_TIMEOUT_MS): FetchLike {
  return (async (url, init) => {
    const target = typeof url === 'string' ? url : url.href
    const resolvedIP = await validateMcpServerSsrf(target)
    const pinnedFetch: FetchLike = resolvedIP ? createPinnedFetch(resolvedIP) : globalThis.fetch
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
    try {
      return await pinnedFetch(url, { ...init, signal })
    } catch (error) {
      if (timeoutSignal.aborted && !init?.signal?.aborted) {
        const host = URL.canParse(target) ? new URL(target).host : target
        throw new McpError(`MCP authorization request to ${host} timed out after ${timeoutMs}ms`)
      }
      throw error
    }
  }) satisfies FetchLike
}
