/** @vitest-environment node */
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as httpServer, type IncomingHttpHeaders } from 'node:http'
import { createSecureServer as http2Server } from 'node:http2'
import { createServer as httpsServer } from 'node:https'
import { type AddressInfo, connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCACertificates, setDefaultCACertificates, type TLSSocket } from 'node:tls'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { resolveHostAddresses } from '@sim/security/dns'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/security/dns', { spy: true })

import {
  createPinnedFetchWithDispatcher,
  createSsrfGuardedFetchWithDispatcher,
  secureFetchWithPinnedIP,
} from '@/lib/core/security/input-validation.server'

const directory = mkdtempSync(join(tmpdir(), 'environment-proxy-tls-'))
const certPath = join(directory, 'cert.pem')
const keyPath = join(directory, 'key.pem')
const sockets = new Set<Socket>()
const connections: Array<{ authority?: string; authorization?: string; proxySni?: string }> = []
const requests: Array<{ headers: IncomingHttpHeaders; sni?: string; protocol?: string }> = []
const origin = httpServer((req, res) => {
  requests.push({ headers: req.headers })
  if (req.url === '/wait') return
  if (req.url === '/redirect') {
    res.writeHead(302, { location: '/done' })
    res.end()
  } else {
    res.end('reached')
  }
})
const secureOrigin = http2Server({ allowHTTP1: true }, (req, res) => {
  requests.push({
    headers: req.headers,
    sni: (req.socket as TLSSocket).servername || undefined,
    protocol: req.httpVersion,
  })
  res.end('tls reached')
})
const proxy = httpServer()
const secureProxy = httpsServer()
let rejectConnections = false
for (const server of [proxy, secureProxy]) {
  server.on('connect', (req, socket, head) => {
    socket.on('error', () => {})
    connections.push({
      authority: req.url,
      authorization: req.headers['proxy-authorization'],
      proxySni: (req.socket as TLSSocket).servername || undefined,
    })
    if (rejectConnections) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
      return
    }
    const target = new URL(`http://${req.url}`)
    const upstream = connect(Number(target.port), target.hostname, () => {
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
}
let originPort = 0
let securePort = 0
let proxyPort = 0
let secureProxyPort = 0
const trust = getCACertificates('default')
beforeAll(async () => {
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
    certPath,
    '-days',
    '2',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost',
    '-addext',
    'extendedKeyUsage=serverAuth',
  ])
  const cert = readFileSync(certPath, 'utf8')
  const key = readFileSync(keyPath, 'utf8')
  secureOrigin.setSecureContext({ cert, key })
  secureProxy.setSecureContext({ cert, key })
  setDefaultCACertificates([...trust, cert])
  for (const server of [origin, secureOrigin, proxy, secureProxy]) {
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  }
  originPort = (origin.address() as AddressInfo).port
  securePort = (secureOrigin.address() as AddressInfo).port
  proxyPort = (proxy.address() as AddressInfo).port
  secureProxyPort = (secureProxy.address() as AddressInfo).port
})
afterAll(async () => {
  for (const socket of sockets) socket.destroy()
  await Promise.all(
    [origin, secureOrigin, proxy, secureProxy].map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  )
  setDefaultCACertificates(trust)
  rmSync(directory, { recursive: true, force: true })
})
beforeEach(() => {
  vi.clearAllMocks()
  for (const name of [
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
  ]) {
    vi.stubEnv(name, '')
  }
  rejectConnections = false
  connections.length = 0
  requests.length = 0
})
afterEach(() => vi.unstubAllEnvs())
const url = () => `http://localhost:${originPort}`
const options = { profile: 'selfHostedService' as const }

/** Both APIs must select the same transport without requiring caller proxy switches. */
describe('operator environment proxies', () => {
  it.each([
    ['http:', 80],
    ['https:', 443],
  ])('uses exactly one default port for %s CONNECT authorities', async (protocol, port) => {
    vi.stubEnv('http_proxy', `http://localhost:${proxyPort}`)
    rejectConnections = true
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', options)
    try {
      await expect(transport.fetch(`${protocol}//localhost`)).rejects.toThrow('GATEWAY_UNAVAILABLE')
      expect(connections).toEqual([{ authority: `127.0.0.1:${port}` }])
      expect(requests).toHaveLength(0)
    } finally {
      await transport.dispatcher.destroy()
    }
  })

  it('pins CONNECT numerically, preserves Host, strips proxy credentials, and follows redirects', async () => {
    vi.stubEnv('http_proxy', `http://operator:synthetic@localhost:${proxyPort}`)
    const transport = createSsrfGuardedFetchWithDispatcher(options)
    try {
      const response = await transport.fetch(`${url()}/redirect`, {
        headers: { 'Proxy-Authorization': 'must-not-reach-origin' },
      })
      expect(await response.text()).toBe('reached')
      expect(connections.length).toBeGreaterThan(0)
      expect(connections.every(({ authority }) => authority === `127.0.0.1:${originPort}`)).toBe(
        true
      )
      expect(connections[0].authorization).toBe(
        `Basic ${Buffer.from('operator:synthetic').toString('base64')}`
      )
      expect(requests).toHaveLength(2)
      expect(requests.every(({ headers }) => headers.host === `localhost:${originPort}`)).toBe(true)
      expect(requests.every(({ headers }) => headers['proxy-authorization'] === undefined)).toBe(
        true
      )
    } finally {
      await transport.dispatcher.destroy()
    }
  })

  it('supports bounded fetch over HTTPS proxy with original origin and proxy TLS identities', async () => {
    vi.stubEnv('https_proxy', `https://localhost:${secureProxyPort}`)
    const response = await secureFetchWithPinnedIP(
      `https://localhost:${securePort}`,
      '127.0.0.1',
      options
    )
    expect(await response.text()).toBe('tls reached')
    expect(connections[0]).toMatchObject({
      authority: `127.0.0.1:${securePort}`,
      proxySni: 'localhost',
    })
    expect(requests[0]).toMatchObject({
      headers: { host: `localhost:${securePort}` },
      sni: 'localhost',
    })
  })

  it('rejects a mismatched origin certificate without a direct fallback', async () => {
    vi.stubEnv('https_proxy', `http://localhost:${proxyPort}`)
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', options)
    try {
      await expect(transport.fetch(`https://127.0.0.1:${securePort}`)).rejects.toThrow()
      expect(connections).toHaveLength(1)
      expect(requests).toHaveLength(0)
    } finally {
      await transport.dispatcher.destroy()
    }
  })

  it('rejects a mismatched proxy certificate before sending CONNECT', async () => {
    vi.stubEnv('https_proxy', `https://127.0.0.1:${secureProxyPort}`)
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', options)
    try {
      await expect(transport.fetch(`https://localhost:${securePort}`)).rejects.toThrow(
        'GATEWAY_UNAVAILABLE'
      )
      expect(connections).toHaveLength(0)
      expect(requests).toHaveLength(0)
    } finally {
      await transport.dispatcher.destroy()
    }
  })

  it('uses NO_PROXY against the original hostname while still pinning direct sockets', async () => {
    vi.stubEnv('http_proxy', `http://localhost:${proxyPort}`)
    vi.stubEnv('no_proxy', `localhost:${originPort}`)
    const transport = createSsrfGuardedFetchWithDispatcher(options)
    try {
      expect(await (await transport.fetch(url())).text()).toBe('reached')
      expect(connections).toHaveLength(0)
      expect(requests[0].headers.host).toBe(`localhost:${originPort}`)
    } finally {
      await transport.dispatcher.destroy()
    }
  })

  it('retains HTTP/2 on a pinned NO_PROXY connection', async () => {
    vi.stubEnv('https_proxy', `http://localhost:${proxyPort}`)
    vi.stubEnv('no_proxy', 'localhost')
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', { ...options, allowH2: true })
    try {
      expect(await (await transport.fetch(`https://localhost:${securePort}`)).text()).toBe(
        'tls reached'
      )
      expect(connections).toHaveLength(0)
      expect(requests[0]).toMatchObject({ protocol: '2.0', sni: 'localhost' })
    } finally {
      await transport.dispatcher.destroy()
    }
  })

  it('cancels a proxied request without opening a direct fallback', async () => {
    vi.stubEnv('http_proxy', `http://localhost:${proxyPort}`)
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', options)
    const controller = new AbortController()
    const received = new Promise<void>((resolve) => origin.once('request', () => resolve()))
    try {
      const pending = transport.fetch(`${url()}/wait`, { signal: controller.signal })
      const rejected = expect(pending).rejects.toThrow()
      await received
      controller.abort()
      await rejected
      expect(connections).toHaveLength(1)
      expect(requests).toHaveLength(1)
    } finally {
      await transport.dispatcher.destroy()
    }
  })

  it.each(['', '*'])('refuses private content targets even with NO_PROXY=%s', async (noProxy) => {
    vi.stubEnv('https_proxy', `http://localhost:${proxyPort}`)
    vi.stubEnv('no_proxy', noProxy)
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', { profile: 'contentFetch' })
    try {
      await expect(transport.fetch(`https://localhost:${securePort}`)).rejects.toThrow()
      expect(connections).toHaveLength(0)
      expect(requests).toHaveLength(0)
    } finally {
      await transport.dispatcher.destroy()
    }
  })

  it.each(['http://169.254.169.254', 'http://[fd00:ec2::254]'])(
    'refuses metadata proxy %s',
    async (proxyUrl) => {
      vi.stubEnv('http_proxy', proxyUrl)
      const transport = createPinnedFetchWithDispatcher('127.0.0.1', options)
      try {
        await expect(transport.fetch(url())).rejects.toThrow()
        expect(requests).toHaveLength(0)
      } finally {
        await transport.dispatcher.destroy()
      }
    }
  )

  it('checks every resolved proxy address before dialing', async () => {
    vi.stubEnv('http_proxy', `http://proxy.invalid:${proxyPort}`)
    vi.mocked(resolveHostAddresses).mockResolvedValueOnce({
      addresses: ['127.0.0.1', '169.254.169.254'],
      preferred: '127.0.0.1',
    })
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', options)
    try {
      await expect(transport.fetch(url())).rejects.toThrow()
      expect(resolveHostAddresses).toHaveBeenCalledWith('proxy.invalid')
      expect(connections).toHaveLength(0)
      expect(requests).toHaveLength(0)
    } finally {
      await transport.dispatcher.destroy()
    }
  })

  it.each(['socks5://operator:synthetic@localhost:1080', 'http://operator@localhost:1080'])(
    'fails closed on invalid proxy configuration without exposing credentials: %s',
    async (proxyUrl) => {
      vi.stubEnv('http_proxy', proxyUrl)
      const transport = createPinnedFetchWithDispatcher('127.0.0.1', options)
      try {
        await expect(transport.fetch(url())).rejects.toThrow('INVALID_CONFIGURATION')
        expect(requests).toHaveLength(0)
      } finally {
        await transport.dispatcher.destroy()
      }
    }
  )

  it('does not fall back to a direct socket when the proxy refuses a connection', async () => {
    vi.stubEnv('http_proxy', 'http://operator:synthetic@127.0.0.1:1')
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', options)
    try {
      await expect(transport.fetch(url())).rejects.toThrow('GATEWAY_UNAVAILABLE')
      expect(requests).toHaveLength(0)
    } finally {
      await transport.dispatcher.destroy()
    }
  })

  it('preserves proxy routing and TLS verification under the actual Bun runtime', async () => {
    await promisify(execFile)(
      'bun',
      [
        '--no-env-file',
        'run',
        fileURLToPath(new URL('./fixtures/environment-proxy-runtime.fixture.ts', import.meta.url)),
        String(securePort),
      ],
      {
        /** The child must fail with its diagnostics before Vitest's 10-second deadline. */
        timeout: 8_000,
        killSignal: 'SIGKILL',
        env: {
          ...process.env,
          NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
          NEXT_PUBLIC_FORCE_HOSTED: 'false',
          NODE_EXTRA_CA_CERTS: certPath,
          https_proxy: `https://localhost:${secureProxyPort}`,
          OUTBOUND_ROUTING_SOURCE: undefined,
          OUTBOUND_ROUTING_CONFIG: undefined,
        },
      }
    )
    expect(connections).toHaveLength(3)
    expect(connections.every(({ authority }) => authority === `127.0.0.1:${securePort}`)).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests.every(({ sni }) => sni === 'localhost')).toBe(true)
  })

  it('gives an explicit per-request proxy precedence over the environment proxy', async () => {
    vi.stubEnv('https_proxy', 'socks5://operator:synthetic@localhost:1080')
    const response = await secureFetchWithPinnedIP(`https://localhost:${securePort}`, '127.0.0.1', {
      ...options,
      proxyUrl: `http://localhost:${proxyPort}`,
    })
    expect(await response.text()).toBe('tls reached')
    expect(connections[0].authority).toBe(`localhost:${securePort}`)
  })
})
