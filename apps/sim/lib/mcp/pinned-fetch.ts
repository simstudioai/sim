import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Agent, type RequestInit as UndiciRequestInit, fetch as undiciFetch } from 'undici'
import { createPinnedLookup } from '@/lib/core/security/input-validation.server'

/**
 * Pins outbound HTTP connections to a pre-resolved IP to prevent DNS-rebinding
 * between URL validation and connection. Hostname is preserved so TLS SNI and
 * the Host header still match the certificate.
 *
 * Agents are pooled by `resolvedIP` so back-to-back calls to the same server
 * reuse the same keep-alive connection pool instead of opening a fresh TCP +
 * TLS connection per McpClient instance.
 */
const MAX_POOLED_AGENTS = 64
const pinnedAgents = new Map<string, Agent>()

function getPinnedAgent(resolvedIP: string): Agent {
  const existing = pinnedAgents.get(resolvedIP)
  if (existing) {
    // LRU touch — re-insert to mark as most recently used.
    pinnedAgents.delete(resolvedIP)
    pinnedAgents.set(resolvedIP, existing)
    return existing
  }
  if (pinnedAgents.size >= MAX_POOLED_AGENTS) {
    // Drop the oldest entry WITHOUT closing it — existing `createMcpPinnedFetch`
    // closures may still hold a reference and have in-flight requests. The
    // dispatcher is GC'd (and its sockets cleaned up) when the last closure
    // releases it; undici closes idle keep-alive connections after its own
    // timeout (default 4s).
    const oldestKey = pinnedAgents.keys().next().value
    if (oldestKey !== undefined) pinnedAgents.delete(oldestKey)
  }
  const agent = new Agent({ connect: { lookup: createPinnedLookup(resolvedIP) } })
  pinnedAgents.set(resolvedIP, agent)
  return agent
}

export function __resetPinnedAgentsForTests(): void {
  pinnedAgents.clear()
}

export function createMcpPinnedFetch(resolvedIP: string): FetchLike {
  const dispatcher = getPinnedAgent(resolvedIP)

  return (async (url, init) => {
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
