import { isIP } from 'node:net'
import { checkServerIdentity, type TLSSocket } from 'node:tls'
import { resolveHostAddresses } from '@sim/security/dns'
import { createEgressPolicy, evaluateAddress } from '@sim/security/egress'
import {
  type Agent,
  buildConnector,
  type Dispatcher,
  EnvHttpProxyAgent,
  Pool,
  request,
} from 'undici/index.js'
import { resolveCurrentOutboundRoute } from '@/lib/core/network/context.server'
import { createGatewayDispatcher, secureOutboundTunnel } from '@/lib/core/network/gateway.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import type { EgressProfile } from '@/lib/core/security/egress/profiles'
import { checkResolvedEgress, validateEgressUrl } from '@/lib/core/security/egress/validate'

interface OutboundTransportOptions {
  profile: EgressProfile
  resolvedIP?: string
  maxResponseSize?: number
  allowH2?: boolean
  direct?: Agent
  proxyUrl?: string
}

/** Operator proxies select by original origin; their CONNECT destinations remain locally validated IPs. */
function createEnvironmentProxyDispatcher(options: OutboundTransportOptions): Dispatcher | null {
  const httpProxy = process.env.http_proxy ?? process.env.HTTP_PROXY
  const httpsProxy = process.env.https_proxy ?? process.env.HTTPS_PROXY
  if (!httpProxy && !httpsProxy) return null

  /** Bun's nested TLS sockets need an explicit identity check, including IP-literal origins. */
  const verifiedConnection =
    (target: URL, callback: buildConnector.Callback): buildConnector.Callback =>
    (...[error, socket]) => {
      if (error) {
        callback(new OutboundRoutingError('GATEWAY_UNAVAILABLE'), null)
        return
      }
      try {
        if (target.protocol === 'https:') {
          const tlsSocket = socket as TLSSocket
          const hostname = target.hostname.replace(/^\[|\]$/g, '')
          if (
            !tlsSocket.authorized ||
            checkServerIdentity(hostname, tlsSocket.getPeerCertificate())
          ) {
            throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
          }
        }
      } catch {
        socket.destroy()
        callback(new OutboundRoutingError('GATEWAY_UNAVAILABLE'), null)
        return
      }
      callback(null, socket)
    }

  try {
    for (const value of [httpProxy, httpsProxy]) {
      if (!value) continue
      const proxy = new URL(value)
      if (
        !['http:', 'https:'].includes(proxy.protocol) ||
        proxy.pathname !== '/' ||
        proxy.search ||
        proxy.hash ||
        Boolean(proxy.username) !== Boolean(proxy.password)
      ) {
        throw new OutboundRoutingError('INVALID_CONFIGURATION')
      }
    }

    return new EnvHttpProxyAgent({
      httpProxy,
      httpsProxy,
      proxyTunnel: true,
      allowH2: options.allowH2 ?? false,
      ...(options.maxResponseSize !== undefined
        ? { maxResponseSize: options.maxResponseSize }
        : {}),
      clientFactory(origin, clientOptions) {
        const settings = clientOptions as Pool.Options
        const connect = settings.connect
        if (typeof connect !== 'function') {
          throw new OutboundRoutingError('INVALID_CONFIGURATION')
        }
        const hostname = origin.hostname.replace(/^\[|\]$/g, '')
        const literal = isIP(hostname)
        const policy = createEgressPolicy({
          ...(literal ? { allowedRanges: [hostname] } : { allowedHosts: [hostname] }),
          insecureHttp: 'always',
        })
        return new Pool(origin, {
          ...settings,
          connect(connection, callback) {
            void (async () => {
              const resolved = literal
                ? { addresses: [hostname], preferred: hostname }
                : await resolveHostAddresses(hostname)
              if (
                resolved.addresses.some(
                  (address) => !evaluateAddress(origin, address, policy).allowed
                )
              ) {
                throw new OutboundRoutingError('ROUTE_BLOCKED')
              }
              connect(
                {
                  ...connection,
                  host: origin.host,
                  hostname: resolved.preferred,
                  servername: literal ? undefined : hostname,
                },
                verifiedConnection(origin, callback)
              )
            })().catch((error) =>
              callback(
                error instanceof OutboundRoutingError
                  ? error
                  : new OutboundRoutingError('GATEWAY_UNAVAILABLE'),
                null
              )
            )
          },
        })
      },
      factory(origin, poolOptions) {
        const settings = poolOptions as Pool.Options
        const tunneled = typeof settings.connect === 'function'
        const connect =
          typeof settings.connect === 'function'
            ? settings.connect
            : buildConnector({ ...settings.connect, allowH2: options.allowH2 ?? false })
        const target = new URL(origin)
        const hostname = target.hostname.replace(/^\[|\]$/g, '')
        const port = target.port || (target.protocol === 'https:' ? '443' : '80')
        return new Pool(origin, {
          ...settings,
          connect(connection, callback) {
            void (async () => {
              let address = options.resolvedIP
              if (address) {
                if (
                  !isIP(address) ||
                  !checkResolvedEgress(target, address, options.profile).allowed
                ) {
                  throw new OutboundRoutingError('ROUTE_BLOCKED')
                }
              } else {
                const result = await validateEgressUrl(target.href, 'url', options.profile, {
                  logDetails: false,
                })
                if (!result.isValid) throw new OutboundRoutingError('ROUTE_BLOCKED')
                address = result.resolvedIP
              }
              const authority = `${isIP(address) === 6 ? `[${address}]` : address}:${port}`
              const finish = verifiedConnection(target, callback)
              connect(
                {
                  ...connection,
                  protocol: tunneled ? 'http:' : connection.protocol,
                  port,
                  host: tunneled ? authority : target.host,
                  hostname: tunneled ? hostname : address,
                  servername: isIP(hostname) ? undefined : hostname,
                },
                (...[error, socket]) => {
                  if (error) return finish(error, null)
                  if (!tunneled || target.protocol !== 'https:') return finish(null, socket)
                  void secureOutboundTunnel(socket, hostname, Number(port)).then(
                    (secured) => finish(null, secured),
                    () => {
                      socket.destroy()
                      finish(new OutboundRoutingError('GATEWAY_UNAVAILABLE'), null)
                    }
                  )
                }
              )
            })().catch((error) =>
              callback(
                error instanceof OutboundRoutingError
                  ? error
                  : new OutboundRoutingError('GATEWAY_UNAVAILABLE'),
                null
              )
            )
          },
        })
      },
    })
  } catch {
    throw new OutboundRoutingError('INVALID_CONFIGURATION')
  }
}

interface OutboundTransportOwner {
  /** Null delegates to the adapter's existing direct transport. */
  selectDispatcher(): Promise<Dispatcher | null>
  close(): Promise<void>
  destroy(): Promise<void>
}

/**
 * Owns routing and connection lifetimes for every HTTP adapter. Destination provenance
 * and optional pinning are immutable for this owner; policy is resolved per operation.
 */
export function createOutboundTransport(options: OutboundTransportOptions): OutboundTransportOwner {
  const pools = new Map<string, Agent>()
  const retired = new Set<Agent>()
  let closed = false
  let environment: Dispatcher | null | undefined
  const allPools = () => [
    ...(options.direct ? [options.direct] : []),
    ...(environment ? [environment] : []),
    ...pools.values(),
    ...retired,
  ]
  return {
    async selectDispatcher() {
      const route = await resolveCurrentOutboundRoute()
      if (closed) throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
      if (route.kind === 'direct') {
        if (options.proxyUrl) return options.direct ?? null
        if (environment === undefined) environment = createEnvironmentProxyDispatcher(options)
        return environment ?? options.direct ?? null
      }
      if (options.proxyUrl) throw new OutboundRoutingError('UNSUPPORTED_TRANSPORT')
      const key = JSON.stringify([
        route.scopeKey,
        route.gateway.id,
        route.gateway.generation,
        route.revision,
      ])
      let pool = pools.get(key)
      if (!pool) {
        if (retired.size >= 16) throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
        if (pools.size >= 16) {
          const oldest = pools.entries().next().value
          if (oldest) {
            pools.delete(oldest[0])
            retired.add(oldest[1])
            void oldest[1]
              .close()
              .catch(() => {})
              .finally(() => retired.delete(oldest[1]))
          }
        }
        pool = createGatewayDispatcher(route.gateway, options)
        pools.set(key, pool)
      }
      return pool
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
