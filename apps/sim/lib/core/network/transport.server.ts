import { resolveEnvironmentProxy } from '@sim/security/environment-proxy'
import { type Agent, type Dispatcher, ProxyAgent, request } from 'undici/index.js'
import { resolveCurrentOutboundRoute } from '@/lib/core/network/context.server'
import { createGatewayDispatcher } from '@/lib/core/network/gateway.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import type { EgressProfile } from '@/lib/core/security/egress/profiles'
import { validateEgressUrl } from '@/lib/core/security/egress/validate'

/** The egress policy refused a destination the transport was asked to reach through a proxy. */
export class EgressRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EgressRefusedError'
  }
}

interface OutboundTransportOptions {
  profile: EgressProfile
  resolvedIP?: string
  maxResponseSize?: number
  direct?: Agent
  proxyUrl?: string
}

interface OutboundTransportOwner {
  /**
   * Null delegates to the adapter's existing direct transport. Pass the request URL so a
   * direct route can honor the operator's `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`, and the
   * request's signal so cancelling it also cancels that route's destination check.
   */
  selectDispatcher(target?: string, signal?: AbortSignal): Promise<Dispatcher | null>
  close(): Promise<void>
  destroy(): Promise<void>
}

/**
 * Owns routing and connection lifetimes for the shared HTTP helpers. Destination provenance
 * and optional pinning are immutable for this owner; policy is resolved per operation.
 */
export function createOutboundTransport(options: OutboundTransportOptions): OutboundTransportOwner {
  const pools = new Map<string, { gatewayId: string; agent: Agent }>()
  const retired = new Map<string, Set<Agent>>()
  const environmentProxies = new Map<string, ProxyAgent>()
  let closed = false
  const allPools = () => [
    ...(options.direct ? [options.direct] : []),
    ...[...pools.values()].map((pool) => pool.agent),
    ...[...retired.values()].flatMap((agents) => [...agents]),
    ...environmentProxies.values(),
  ]
  /**
   * The proxy resolves the destination itself, so pinning cannot hold across it. Every request
   * (each redirect hop included) is resolved and judged here first, and a name is refused when
   * any of its records is refused, since the proxy may connect to any of them. A name that
   * changes its answer between this check and the proxy's own lookup is left to the proxy's
   * egress policy, which is why the self-hosting docs make the proxy the final egress control.
   */
  const selectEnvironmentProxy = async (
    target: string,
    signal: AbortSignal | undefined
  ): Promise<Dispatcher | null> => {
    const proxyUrl = resolveEnvironmentProxy(new URL(target))
    if (!proxyUrl) return null
    const validation = await validateEgressUrl(target, 'url', options.profile, {
      logDetails: false,
      signal,
      requireEveryAddress: true,
    })
    if (!validation.isValid) {
      if (validation.refusal === 'policy') throw new EgressRefusedError(validation.error)
      throw new Error(validation.error, { cause: validation.cause })
    }
    if (closed) throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
    let agent = environmentProxies.get(proxyUrl)
    if (!agent) {
      agent = new ProxyAgent({
        uri: proxyUrl,
        allowH2: false,
        // Plain-http destinations use absolute-form forwarding, as curl and Bun do.
        proxyTunnel: false,
        ...(options.maxResponseSize !== undefined
          ? { maxResponseSize: options.maxResponseSize }
          : {}),
      })
      environmentProxies.set(proxyUrl, agent)
    }
    return agent
  }
  return {
    async selectDispatcher(target, signal) {
      const route = await resolveCurrentOutboundRoute()
      if (closed) throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
      if (route.kind === 'direct') {
        // A per-request proxy chosen by the workflow outranks the deployment default.
        if (!options.proxyUrl && target !== undefined) {
          const proxy = await selectEnvironmentProxy(target, signal)
          if (proxy) return proxy
        }
        return options.direct ?? null
      }
      if (options.proxyUrl) throw new OutboundRoutingError('UNSUPPORTED_TRANSPORT')
      const owner = route.gateway.organizationId
      const current = pools.get(owner)
      if (current?.gatewayId === route.gateway.id) return current.agent
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
      pools.set(owner, { gatewayId: route.gateway.id, agent })
      return agent
    },
    async close() {
      closed = true
      await Promise.all(allPools().map((pool) => pool.close()))
      pools.clear()
      retired.clear()
      environmentProxies.clear()
    },
    async destroy() {
      closed = true
      await Promise.all(allPools().map((pool) => pool.destroy()))
      pools.clear()
      retired.clear()
      environmentProxies.clear()
    },
  }
}

type OutboundRequestOptions = Omit<
  NonNullable<Parameters<typeof request>[1]>,
  'headers' | 'dispatcher'
> & {
  headers?: Record<string, string>
  dispatcher: Dispatcher
  requestTarget?: string
}

/**
 * The shared HTTP wire transport. Import the installed package explicitly: Bun's bare
 * undici shim ignores dispatchers. Proxy credentials never become destination headers.
 */
export function requestWithOutboundDispatcher(url: string, options: OutboundRequestOptions) {
  const { requestTarget, dispatcher, ...requestOptions } = options
  const headers = { ...options.headers }
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'proxy-authorization') delete headers[name]
  }
  if (requestTarget !== undefined) {
    return dispatcher.request({
      ...requestOptions,
      origin: new URL(url).origin,
      path: requestTarget,
      method: requestOptions.method ?? 'GET',
      headers,
    })
  }
  return request(url, { ...requestOptions, dispatcher, headers })
}
