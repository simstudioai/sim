import { isIP, Socket } from 'node:net'
import { checkServerIdentity, connect as connectTls } from 'node:tls'
import { createLogger } from '@sim/logger'
import { evaluateAddress, STRICT_EGRESS_POLICY } from '@sim/security/egress'
import { toError } from '@sim/utils/errors'
import { Agent, Client } from 'undici/index.js'
import type { OutboundGateway } from '@/lib/core/network/config.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import type { EgressProfile } from '@/lib/core/security/egress/profiles'
import { checkResolvedEgress, validateEgressUrl } from '@/lib/core/security/egress/validate'

const CONNECT_TIMEOUT_MS = 10_000
const MAX_CONNECT_ATTEMPTS = 2

const logger = createLogger('OutboundGateway')

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
  if (
    isIP(address) !== 4 ||
    port !== 443 ||
    !evaluateAddress(new URL(`https://${address}`), address, STRICT_EGRESS_POLICY).allowed
  ) {
    throw new OutboundRoutingError('UNSUPPORTED_TRANSPORT')
  }
  for (let attempt = 1; ; attempt++) {
    const result = await attemptGatewayConnect(gateway, `${address}:443`)
    if (result.socket) return result.socket
    logger.warn('Gateway CONNECT failed', {
      gatewayId: gateway.id,
      organizationId: gateway.organizationId,
      attempt,
      statusCode: result.statusCode,
      errorName: result.error?.name,
      errorCode: getErrorCode(result.error),
    })
    if (!result.retryable || attempt >= MAX_CONNECT_ATTEMPTS) {
      throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
    }
  }
}

type GatewayConnectResult =
  | { socket: Socket; statusCode?: never; error?: never; retryable?: never }
  | { socket?: never; statusCode?: number; error?: Error; retryable: boolean }

/**
 * A failure before the proxy answers 200 has sent no upstream bytes, so it is safe to retry.
 * Credential or admission rejections (4xx) are not transient and never retry.
 */
async function attemptGatewayConnect(
  gateway: OutboundGateway,
  authority: string
): Promise<GatewayConnectResult> {
  /** A fresh client per attempt opens a new connection, which the NLB can route to another task. */
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
    if (statusCode === 200 && socket instanceof Socket) return { socket }
    socket.destroy()
    return { statusCode, retryable: statusCode >= 500 }
  } catch (error) {
    return { error: toError(error), retryable: true }
  } finally {
    /** An upgraded socket is detached from the dispatcher and now belongs to its caller. */
    await client.destroy()
  }
}

function getErrorCode(error: Error | undefined): string | undefined {
  const code = error && 'code' in error ? error.code : undefined
  return typeof code === 'string' ? code : undefined
}

/** A dispatcher belongs to one organization and gateway, never a process-wide default. */
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
        if (connection.protocol !== 'https:' || port !== 443) {
          throw new OutboundRoutingError('UNSUPPORTED_TRANSPORT')
        }
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
        return secureOutboundTunnel(socket, hostname, port)
      })().then(
        (socket) => callback(null, socket),
        (error) =>
          callback(
            error instanceof OutboundRoutingError
              ? error
              : new OutboundRoutingError('GATEWAY_UNAVAILABLE'),
            null
          )
      )
    },
  })
}
