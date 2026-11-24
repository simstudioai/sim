/**
 * A real TLS CONNECT gateway and the HTTPS origin behind it, on loopback, for the gateway suites.
 * One self-signed certificate covers `gateway.invalid` (the proxy), `origin.invalid` and `1.1.1.1`
 * (the origin); the proxy admits only `1.1.1.1:443` and only the bearer tokens it was started with.
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as httpsServer } from 'node:https'
import { type AddressInfo, connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { promisify } from 'node:util'

interface GatewayAdmission {
  token: string | undefined
  destination: string | undefined
  sni: string | undefined
}

export interface GatewayTlsFixture {
  cert: string
  certificatePath: string
  proxyPort: number
  /** Every CONNECT the proxy received, admitted or not. */
  admissions: GatewayAdmission[]
  /** Each queued entry makes one CONNECT fail: `reset` drops the connection, a number answers with that status. */
  connectFailures: Array<'reset' | number>
  /** What the origin last received, and how many requests reached it. */
  origin: { requests: number; headers: Record<string, unknown>; target: string }
  close: () => Promise<void>
}

/**
 * The origin answers `x-via-proxy: yes` only for a connection the proxy opened, echoes the request
 * target in `x-request-target`, echoes POST and PUT bodies, redirects `/redirect`, and never answers
 * `/wait`.
 */
export async function startGatewayTlsFixture(
  acceptedTokens: readonly string[]
): Promise<GatewayTlsFixture> {
  const certificateDirectory = mkdtempSync(join(tmpdir(), 'gateway-tls-'))
  const certificatePath = join(certificateDirectory, 'cert.pem')
  const keyPath = join(certificateDirectory, 'key.pem')
  await promisify(execFile)('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certificatePath,
    '-days',
    '2',
    '-subj',
    '/CN=gateway.invalid',
    '-addext',
    'subjectAltName=DNS:gateway.invalid,DNS:origin.invalid,IP:1.1.1.1',
    '-addext',
    'extendedKeyUsage=serverAuth',
  ])
  const cert = readFileSync(certificatePath, 'utf8')
  const key = readFileSync(keyPath, 'utf8')
  const admittedAuthorizations = new Set(acceptedTokens.map((token) => `Bearer ${token}`))
  const sockets = new Set<Duplex>()
  const proxiedPorts = new Set<number>()
  const admissions: GatewayAdmission[] = []
  const connectFailures: Array<'reset' | number> = []
  const origin: GatewayTlsFixture['origin'] = { requests: 0, headers: {}, target: '' }

  const secureOrigin = httpsServer({ cert, key }, async (req, res) => {
    res.setHeader('x-via-proxy', proxiedPorts.has(req.socket.remotePort ?? 0) ? 'yes' : 'no')
    origin.requests++
    origin.headers = req.headers
    origin.target = req.url ?? ''
    res.setHeader('x-request-target', origin.target)
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/done' })
      res.end()
      return
    }
    if (req.url === '/wait') return
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    res.end(req.method === 'POST' || req.method === 'PUT' ? Buffer.concat(chunks) : 'tls reached')
  })
  const proxy = httpsServer({ cert, key })
  proxy.on('connect', (req, socket, head) => {
    socket.on('error', () => {})
    const tlsSocket = req.socket as Socket & { servername?: string }
    const authorization = req.headers['proxy-authorization']
    admissions.push({ token: authorization, destination: req.url, sni: tlsSocket.servername })
    const failure = connectFailures.shift()
    if (failure === 'reset') {
      socket.destroy()
      return
    }
    if (failure !== undefined) {
      socket.end(`HTTP/1.1 ${failure} Gateway Failure\r\nContent-Length: 0\r\n\r\n`)
      return
    }
    if (!authorization || !admittedAuthorizations.has(authorization)) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n')
      return
    }
    if (req.url !== '1.1.1.1:443') {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
      return
    }
    const upstream = connect((secureOrigin.address() as AddressInfo).port, '127.0.0.1', () => {
      if (upstream.localPort) proxiedPorts.add(upstream.localPort)
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    socket.on('close', () => upstream.destroy())
    sockets.add(upstream)
    upstream.on('close', () => sockets.delete(upstream))
  })

  for (const server of [secureOrigin, proxy]) {
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  }

  return {
    cert,
    certificatePath,
    proxyPort: (proxy.address() as AddressInfo).port,
    admissions,
    connectFailures,
    origin,
    async close() {
      for (const socket of sockets) socket.destroy()
      await Promise.all(
        [secureOrigin, proxy].map(
          (server) => new Promise<void>((resolve) => server.close(() => resolve()))
        )
      )
      rmSync(certificateDirectory, { recursive: true, force: true })
    },
  }
}
