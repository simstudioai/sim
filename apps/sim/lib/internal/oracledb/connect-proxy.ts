import http from 'node:http'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'

const MAX_CONNECT_HEADER_BYTES = 8 * 1024
const MAX_CONNECT_TARGET_BYTES = 1024
const MAX_TUNNELS_PER_OPERATION = 8
const MAX_ACTIVE_TUNNELS = 2

interface ConnectTarget {
  host: string
  port: number
}

export interface OracleConnectProxy {
  host: '127.0.0.1'
  port: number
  close: () => Promise<void>
  getFailureReason: () => string | undefined
}

function parseConnectTarget(authority: string): ConnectTarget | null {
  if (
    authority.length === 0 ||
    Buffer.byteLength(authority, 'utf8') > MAX_CONNECT_TARGET_BYTES ||
    /[\s/@\\]/.test(authority)
  ) {
    return null
  }

  let host: string
  let portText: string
  if (authority.startsWith('[')) {
    const bracket = authority.indexOf(']')
    if (bracket <= 1 || authority[bracket + 1] !== ':') return null
    host = authority.slice(1, bracket)
    portText = authority.slice(bracket + 2)
  } else {
    const separator = authority.lastIndexOf(':')
    if (separator <= 0) return null
    host = authority.slice(0, separator)
    portText = authority.slice(separator + 1)
  }

  if (!/^\d{1,5}$/.test(portText)) return null
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host, port }
}

function isClosed(socket: Duplex): boolean {
  return socket.destroyed || !socket.writable
}

function writeProxyResponse(socket: Duplex, status: number, reason: string): void {
  if (isClosed(socket)) return
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
}

/**
 * Starts a request-scoped CONNECT proxy on loopback.
 *
 * The Oracle Thin driver is configured to reach every initial and redirected
 * Oracle Net address through this listener. Each CONNECT target is resolved and
 * checked independently, then the upstream socket is pinned to the approved IP.
 */
export async function createOracleConnectProxy(
  connectionTimeout: number,
  signal?: AbortSignal
): Promise<OracleConnectProxy> {
  signal?.throwIfAborted()

  let tunnelCount = 0
  let activeTunnels = 0
  let lastFailureReason: string | undefined
  let closePromise: Promise<void> | undefined
  const sockets = new Set<net.Socket>()

  const server = http.createServer(
    {
      maxHeaderSize: MAX_CONNECT_HEADER_BYTES,
      headersTimeout: Math.min(connectionTimeout, 10_000),
      requestTimeout: Math.min(connectionTimeout, 10_000),
    },
    (_request, response) => {
      response.writeHead(405, { Connection: 'close' })
      response.end()
    }
  )

  server.maxConnections = MAX_ACTIVE_TUNNELS
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })

  server.on('connect', (request, clientSocket, head) => {
    void (async () => {
      tunnelCount += 1
      if (tunnelCount > MAX_TUNNELS_PER_OPERATION || activeTunnels >= MAX_ACTIVE_TUNNELS) {
        lastFailureReason = 'Oracle connection exceeded the redirect tunnel limit'
        writeProxyResponse(clientSocket, 429, 'Too Many CONNECT Requests')
        return
      }

      const target = parseConnectTarget(request.url ?? '')
      if (!target) {
        lastFailureReason = 'Oracle supplied an invalid CONNECT target'
        writeProxyResponse(clientSocket, 400, 'Invalid CONNECT Target')
        return
      }

      const validation = await validateDatabaseHost(target.host, 'Oracle Database host', {
        logDetails: false,
      })
      if (!validation.isValid) {
        lastFailureReason = validation.error
        writeProxyResponse(clientSocket, 403, 'CONNECT Target Blocked')
        return
      }
      if (isClosed(clientSocket) || signal?.aborted) {
        clientSocket.destroy()
        return
      }

      activeTunnels += 1
      const upstream = net.createConnection({ host: validation.resolvedIP, port: target.port })
      sockets.add(upstream)
      upstream.setNoDelay(true)
      upstream.setTimeout(connectionTimeout)

      let connected = false
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        activeTunnels -= 1
        sockets.delete(upstream)
        clientSocket.destroy()
        upstream.destroy()
      }

      upstream.once('connect', () => {
        connected = true
        upstream.setTimeout(0)
        if (isClosed(clientSocket)) {
          finish()
          return
        }
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length > 0) upstream.write(head)
        clientSocket.pipe(upstream)
        upstream.pipe(clientSocket)
      })
      upstream.once('timeout', () => {
        lastFailureReason = `Connection to the validated Oracle host timed out after ${connectionTimeout} ms`
        if (!connected) writeProxyResponse(clientSocket, 504, 'CONNECT Timeout')
        finish()
      })
      upstream.once('error', () => {
        lastFailureReason = 'Could not connect to the validated Oracle Database host'
        if (!connected) writeProxyResponse(clientSocket, 502, 'CONNECT Failed')
        finish()
      })
      upstream.once('close', finish)
      clientSocket.once('error', finish)
      clientSocket.once('close', finish)
    })().catch(() => {
      lastFailureReason = 'Oracle CONNECT proxy failed unexpectedly'
      writeProxyResponse(clientSocket, 500, 'CONNECT Proxy Failure')
    })
  })

  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => {
      server.removeListener('listening', ready)
      reject(error)
    }
    const ready = () => {
      server.removeListener('error', fail)
      resolve()
    }
    server.once('error', fail)
    server.once('listening', ready)
    server.listen(0, '127.0.0.1')
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Oracle CONNECT proxy did not bind a TCP port')
  }

  const close = (): Promise<void> => {
    if (closePromise) return closePromise
    signal?.removeEventListener('abort', abort)
    for (const socket of sockets) socket.destroy()
    closePromise = new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
    return closePromise
  }
  const abort = () => {
    void close()
  }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) {
    await close()
    signal.throwIfAborted()
  }

  return {
    host: '127.0.0.1',
    port: address.port,
    close,
    getFailureReason: () => lastFailureReason,
  }
}

export const oracleConnectProxyInternals = {
  parseConnectTarget,
}
