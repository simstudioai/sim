import { type Agent, type Dispatcher, request } from 'undici/index.js'
import { resolveCurrentOutboundRoute } from '@/lib/core/network/context.server'
import { createGatewayDispatcher } from '@/lib/core/network/gateway.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import type { EgressProfile } from '@/lib/core/security/egress/profiles'

interface OutboundTransportOptions {
  profile: EgressProfile
  resolvedIP?: string
  maxResponseSize?: number
  direct?: Agent
  proxyUrl?: string
}

interface OutboundTransportOwner {
  /** Null delegates to the adapter's existing direct transport. */
  selectDispatcher(): Promise<Dispatcher | null>
  close(): Promise<void>
  destroy(): Promise<void>
}

/**
 * Owns routing and connection lifetimes for the shared HTTP helpers. Destination provenance
 * and optional pinning are immutable for this owner; policy is resolved per operation.
 */
export function createOutboundTransport(options: OutboundTransportOptions): OutboundTransportOwner {
  const pools = new Map<string, { identity: string; agent: Agent }>()
  const retired = new Map<string, Set<Agent>>()
  let closed = false
  const allPools = () => [
    ...(options.direct ? [options.direct] : []),
    ...[...pools.values()].map((pool) => pool.agent),
    ...[...retired.values()].flatMap((agents) => [...agents]),
  ]
  return {
    async selectDispatcher() {
      const route = await resolveCurrentOutboundRoute()
      if (closed) throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
      if (route.kind === 'direct') return options.direct ?? null
      if (options.proxyUrl) throw new OutboundRoutingError('UNSUPPORTED_TRANSPORT')
      const owner = route.gateway.organizationId
      const identity = JSON.stringify([route.gateway.id, route.gateway.generation])
      const current = pools.get(owner)
      if (current?.identity === identity) return current.agent
      const draining = retired.get(owner) ?? new Set<Agent>()
      if (draining.size >= 2) throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
      const agent = createGatewayDispatcher(route.gateway, options)
      if (current) {
        retired.set(owner, draining)
        draining.add(current.agent)
        void current.agent
          .close()
          .catch(() => {})
          .finally(() => {
            draining.delete(current.agent)
            if (draining.size === 0) retired.delete(owner)
          })
      }
      pools.set(owner, { identity, agent })
      return agent
    },
    async close() {
      closed = true
      await Promise.all(allPools().map((pool) => pool.close()))
      pools.clear()
      retired.clear()
    },
    async destroy() {
      closed = true
      await Promise.all(allPools().map((pool) => pool.destroy()))
      pools.clear()
      retired.clear()
    },
  }
}

type OutboundRequestOptions = Omit<
  NonNullable<Parameters<typeof request>[1]>,
  'headers' | 'dispatcher'
> & {
  headers?: Record<string, string>
  dispatcher: Dispatcher
}

/**
 * The shared HTTP wire transport. Import the installed package explicitly: Bun's bare
 * undici shim ignores dispatchers. Proxy credentials never become destination headers.
 */
export function requestWithOutboundDispatcher(url: string, options: OutboundRequestOptions) {
  const headers = { ...options.headers }
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'proxy-authorization') delete headers[name]
  }
  return request(url, { ...options, headers })
}
