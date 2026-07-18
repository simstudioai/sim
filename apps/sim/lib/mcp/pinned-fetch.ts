import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  createPinnedFetch,
  createPinnedFetchWithDispatcher,
} from '@/lib/core/security/input-validation.server'
import { validateMcpServerSsrf } from '@/lib/mcp/domain-check'

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
 * Note: a caller-provided `AbortSignal` in `init` only bounds the HTTP request,
 * not the validation DNS lookup — Node's `dns.lookup` does not accept a signal,
 * so a hanging resolution can extend the overall call past the caller's timeout
 * by up to the OS DNS timeout. Acceptable here because all consumers are
 * best-effort, non-blocking flows (OAuth discovery and RFC 7009 revocation).
 *
 * @throws McpSsrfError if a request URL resolves to a blocked IP address
 */
export function createSsrfGuardedMcpFetch(): FetchLike {
  return (async (url, init) => {
    const target = typeof url === 'string' ? url : url.href
    const resolvedIP = await validateMcpServerSsrf(target)
    const pinnedFetch: FetchLike = resolvedIP ? createPinnedFetch(resolvedIP) : globalThis.fetch
    return pinnedFetch(url, init)
  }) satisfies FetchLike
}
