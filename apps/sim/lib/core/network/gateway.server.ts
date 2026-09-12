import { isIP, Socket } from 'node:net'
import { checkServerIdentity, connect as connectTls } from 'node:tls'
import { Agent, Client } from 'undici/index.js'
import type { OutboundGateway } from '@/lib/core/network/config.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import type { EgressProfile } from '@/lib/core/security/egress/profiles'
import { checkResolvedEgress, validateEgressUrl } from '@/lib/core/security/egress/validate'

const CONNECT_TIMEOUT_MS = 10_000

/** The proxy CA never changes trust for the upstream service. */
export async function secureOutboundTunnel(
  socket: Socket,
  hostname: string,
  port: number
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const tls = connectTls({
      socket,
      host: hostname,
      port,
      servername: isIP(hostname) ? undefined : hostname,
      checkServerIdentity: (_name, certificate) => checkServerIdentity(hostname, certificate),
      rejectUnauthorized: true,
      ALPNProtocols: ['http/1.1'],
    })
    /** The inner TLS stream has no TCP descriptor; QoS must be applied to the outer socket. */
    if ('setTypeOfService' in socket && typeof socket.setTypeOfService === 'function') {
      const setTypeOfService = socket.setTypeOfService.bind(socket)
      Object.defineProperty(tls, 'setTypeOfService', {
        value(tos: number) {
          setTypeOfService(tos)
          return tls
        },
      })
    }
    const timer = setTimeout(
      () => tls.destroy(new OutboundRoutingError('GATEWAY_UNAVAILABLE')),
      CONNECT_TIMEOUT_MS
    )
    timer.unref()
    tls.once('secureConnect', () => {
      clearTimeout(timer)
      resolve(tls)
    })
    tls.once('error', () => {
      clearTimeout(timer)
      reject(new OutboundRoutingError('GATEWAY_UNAVAILABLE'))
    })
  })
}

/** Uses the npm HTTP parser on both runtimes; Bun's Node HTTP shim cannot send CONNECT. */
export async function openGatewayTunnel(
  gateway: OutboundGateway,
  address: string,
  port: number
): Promise<Socket> {
  if (!isIP(address) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new OutboundRoutingError('INVALID_CONFIGURATION')
  }
  const authority = `${isIP(address) === 6 ? `[${address}]` : address}:${port}`
  const client = new Client(gateway.url, {
    allowH2: false,
    maxHeaderSize: 16_384,
    connectTimeout: CONNECT_TIMEOUT_MS,
    connect: { servername: gateway.servername, ca: gateway.ca, rejectUnauthorized: true },
  })
  try {
    const { statusCode, socket } = await client.connect({
      path: authority,
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      headers: { host: authority, 'proxy-authorization': `Bearer ${gateway.token}` },
    })
    if (statusCode !== 200 || !(socket instanceof Socket)) {
      socket.destroy()
      throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
    }
    return socket
  } catch {
    throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
  } finally {
    /** An upgraded socket is detached from the dispatcher and now belongs to its caller. */
    await client.destroy()
  }
}

/** A dispatcher belongs to one organization and gateway revision, never a process-wide default. */
export function createGatewayDispatcher(
  gateway: OutboundGateway,
  options: { profile: EgressProfile; resolvedIP?: string; maxResponseSize?: number }
): Agent {
  return new Agent({
    allowH2: false,
    ...(options.maxResponseSize !== undefined ? { maxResponseSize: options.maxResponseSize } : {}),
    connect(connection, callback) {
      const port = Number(connection.port || (connection.protocol === 'https:' ? 443 : 80))
      const hostname = connection.hostname.replace(/^\[|\]$/g, '')
      const authority = isIP(hostname) === 6 ? `[${hostname}]` : hostname
      const url = new URL(`${connection.protocol}//${authority}:${port}`)
      void (async () => {
        let address = options.resolvedIP
        if (address) {
          if (!checkResolvedEgress(url, address, options.profile).allowed) {
            throw new OutboundRoutingError('ROUTE_BLOCKED')
          }
        } else {
          const result = await validateEgressUrl(url.href, 'url', options.profile, {
            logDetails: false,
          })
          if (!result.isValid) throw new OutboundRoutingError('ROUTE_BLOCKED')
          address = result.resolvedIP
        }
        const socket = await openGatewayTunnel(gateway, address, port)
        if (connection.protocol !== 'https:') return socket
        return secureOutboundTunnel(socket, hostname, port)
      })().then(
        (socket) => callback(null, socket),
        () => callback(new OutboundRoutingError('GATEWAY_UNAVAILABLE'), null)
      )
    },
  })
}
