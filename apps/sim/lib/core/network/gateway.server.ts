import { isIP, type Socket } from 'node:net'
import { checkServerIdentity, connect as connectTls } from 'node:tls'
import { OutboundRoutingError } from '@/lib/core/network/routing'

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
