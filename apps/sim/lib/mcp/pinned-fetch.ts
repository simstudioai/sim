import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Agent, type RequestInit as UndiciRequestInit, fetch as undiciFetch } from 'undici'
import { createPinnedLookup } from '@/lib/core/security/input-validation.server'

/**
 * Creates a FetchLike that pins all outbound HTTP connections to a pre-resolved
 * IP address. Used by the MCP transport to prevent DNS-rebinding (TOCTOU)
 * attacks: validation performs DNS once and confirms the IP is allowed; this
 * fetch then forces every subsequent request (initial POST, SSE GET, redirects)
 * to use that same IP, regardless of what the hostname now resolves to.
 *
 * Uses undici's `fetch` directly so the `dispatcher` option is part of the
 * real type contract — not a cast that would silently break if a future
 * runtime swapped out the implementation.
 *
 * The original hostname is preserved on the request so TLS SNI and the Host
 * header continue to match the certificate.
 */
export function createMcpPinnedFetch(resolvedIP: string): FetchLike {
  const dispatcher = new Agent({
    connect: { lookup: createPinnedLookup(resolvedIP) },
  })

  return (async (url, init) => {
    // DOM `RequestInit` and undici's `RequestInit` are structurally compatible
    // at runtime (Node's global fetch IS undici) but differ in TS types.
    // Cast the init through unknown to bridge the typing without losing the
    // critical `dispatcher` typing on the call itself.
    const undiciInit: UndiciRequestInit = {
      // double-cast-allowed: DOM RequestInit and undici RequestInit are structurally compatible at runtime (Node's global fetch IS undici) but the TS types differ
      ...(init as unknown as UndiciRequestInit),
      dispatcher,
    }
    const response = await undiciFetch(url as string | URL, undiciInit)
    // double-cast-allowed: undici Response and DOM Response are structurally compatible at runtime; bridging the types is required to satisfy the FetchLike contract
    return response as unknown as Response
  }) satisfies FetchLike
}
