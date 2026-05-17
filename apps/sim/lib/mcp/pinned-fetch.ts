import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Agent } from 'undici'
import { createPinnedLookup } from '@/lib/core/security/input-validation.server'

/**
 * Creates a FetchLike that pins all outbound HTTP connections to a pre-resolved
 * IP address. Used by the MCP transport to prevent DNS-rebinding (TOCTOU)
 * attacks: validation performs DNS once and confirms the IP is allowed; this
 * fetch then forces every subsequent request (initial POST, SSE GET, redirects)
 * to use that same IP, regardless of what the hostname now resolves to.
 *
 * The original hostname is preserved on the request so TLS SNI and the Host
 * header continue to match the certificate.
 */
export function createMcpPinnedFetch(resolvedIP: string): FetchLike {
  const dispatcher = new Agent({
    connect: { lookup: createPinnedLookup(resolvedIP) },
  })

  return (url, init) =>
    globalThis.fetch(url, {
      ...(init ?? {}),
      dispatcher,
    } as RequestInit & { dispatcher: Agent })
}
