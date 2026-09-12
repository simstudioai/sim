/** @vitest-environment node */
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as httpServer } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { type AddressInfo, connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { OutboundGateway, ResolvedOutboundRoute } from '@/lib/core/network/config.server'

const { state } = vi.hoisted(() => ({
  state: { gateways: new Map<string, OutboundGateway>(), revision: 'v1' },
}))
vi.mock('@/lib/core/network/config.server', () => ({
  async resolveOutboundRoute(
    organizationId: string | null | undefined
  ): Promise<ResolvedOutboundRoute> {
    const gateway = organizationId ? state.gateways.get(organizationId) : undefined
    if (!gateway || !organizationId) throw new Error('No configured route')
    return { kind: 'gateway', gateway, scopeKey: organizationId, revision: state.revision }
  },
}))

import { createOutboundAwsHttpHandler } from '@/lib/core/network/aws-handler.server'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { openGatewayTunnel } from '@/lib/core/network/gateway.server'
import {
  createPinnedFetchWithDispatcher,
  secureFetchWithPinnedIP,
} from '@/lib/core/security/input-validation.server'

const certificateDirectory = mkdtempSync(join(tmpdir(), 'gateway-tls-'))
const certificatePath = join(certificateDirectory, 'cert.pem')
const keyPath = join(certificateDirectory, 'key.pem')
let cert = ''
const sockets = new Set<Socket>()
const admissions: Array<{
  token: string | undefined
  destination: string | undefined
  sni: string | undefined
}> = []
let originRequests = 0
let receivedHeaders: Record<string, unknown> = {}
const origin = httpServer(async (req, res) => {
  originRequests++
  receivedHeaders = req.headers
  if (req.url === '/redirect') {
    res.writeHead(302, { location: '/done' })
    res.end()
    return
  }
  if (req.url === '/wait') return
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  res.end(req.method === 'POST' ? Buffer.concat(chunks) : 'reached')
})
const proxiedPorts = new Set<number>()
const secureOrigin = httpsServer((req, res) => {
  res.setHeader('x-via-proxy', proxiedPorts.has(req.socket.remotePort ?? 0) ? 'yes' : 'no')
  res.end('tls reached')
})
const proxy = httpsServer()
proxy.on('connect', (req, socket, head) => {
  socket.on('error', () => {})
  const tlsSocket = req.socket as Socket & { servername?: string }
  admissions.push({
    token: req.headers['proxy-authorization'],
    destination: req.url,
    sni: tlsSocket.servername,
  })
  if (!req.headers['proxy-authorization']?.match(/^Bearer (alpha|bravo|a{48})$/)) {
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n')
    return
  }
  const target = new URL(`http://${req.url}`)
  const upstream = connect(Number(target.port), target.hostname, () => {
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
let originPort = 0
let securePort = 0
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
    certificatePath,
    '-days',
    '2',
    '-subj',
    '/CN=gateway.invalid',
    '-addext',
    'subjectAltName=DNS:gateway.invalid,DNS:localhost',
    '-addext',
    'extendedKeyUsage=serverAuth',
  ])
  cert = readFileSync(certificatePath, 'utf8')
  const key = readFileSync(keyPath, 'utf8')
  for (const server of [secureOrigin, proxy]) server.setSecureContext({ cert, key })
  setDefaultCACertificates([...trust, cert])
  for (const server of [origin, secureOrigin, proxy]) {
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  }
  originPort = (origin.address() as AddressInfo).port
  securePort = (secureOrigin.address() as AddressInfo).port
  const proxyPort = (proxy.address() as AddressInfo).port
  for (const [id, token] of [
    ['org_a', 'alpha'],
    ['org_b', 'bravo'],
  ])
    state.gateways.set(id, {
      id,
      token,
      url: `https://127.0.0.1:${proxyPort}`,
      servername: 'gateway.invalid',
      generation: '1',
      ca: cert,
    })
})
afterAll(async () => {
  for (const socket of sockets) socket.destroy()
  await Promise.all(
    [origin, secureOrigin, proxy].map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  )
  setDefaultCACertificates(trust)
  rmSync(certificateDirectory, { recursive: true, force: true })
})
const url = () => `http://localhost:${originPort}`
const options = { profile: 'selfHostedService' as const }

describe('organization gateways over real TLS CONNECT sockets', () => {
  it('keeps an upgraded tunnel usable after five minutes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let tunnel: Socket | undefined
    try {
      tunnel = await openGatewayTunnel(state.gateways.get('org_a')!, '127.0.0.1', originPort)
      await vi.advanceTimersByTimeAsync(6 * 60_000)
      expect(tunnel.destroyed).toBe(false)
      tunnel.write('GET /done HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
      const chunks: Buffer[] = []
      for await (const chunk of tunnel) chunks.push(Buffer.from(chunk))
      expect(Buffer.concat(chunks).toString()).toContain('reached')
    } finally {
      tunnel?.destroy()
      vi.useRealTimers()
    }
  })

  it('pins guarded requests and keeps proxy credentials out of origin headers', async () => {
    const response = await runWithOutboundOrganization('org_a', () =>
      secureFetchWithPinnedIP(url(), '127.0.0.1', {
        ...options,
        headers: { 'Proxy-Authorization': 'must-not-reach-origin' },
      })
    )
    expect(await response.text()).toBe('reached')
    expect(admissions.at(-1)).toEqual({
      token: 'Bearer alpha',
      destination: `127.0.0.1:${originPort}`,
      sni: 'gateway.invalid',
    })
    expect(receivedHeaders['proxy-authorization']).toBeUndefined()
    expect(receivedHeaders.host).toBe(`localhost:${originPort}`)
  })
  it('isolates concurrent requests to the same origin and rotates pools on revision change', async () => {
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', options)
    const start = admissions.length
    try {
      expect(
        await Promise.all(
          ['org_a', 'org_b'].map((id) =>
            runWithOutboundOrganization(id, async () => (await transport.fetch(url())).text())
          )
        )
      ).toEqual(['reached', 'reached'])
      expect(
        admissions
          .slice(start)
          .map((item) => item.token)
          .sort()
      ).toEqual(['Bearer alpha', 'Bearer bravo'])
      state.revision = 'v2'
      await runWithOutboundOrganization('org_a', async () => (await transport.fetch(url())).text())
      expect(admissions.length).toBe(start + 3)
    } finally {
      await transport.dispatcher.destroy()
    }
  })
  it('preserves upstream TLS identity on both transports and rejects the wrong hostname', async () => {
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', options)
    try {
      await runWithOutboundOrganization('org_a', async () => {
        expect(await (await transport.fetch(`https://localhost:${securePort}`)).text()).toBe(
          'tls reached'
        )
        expect(
          await (
            await secureFetchWithPinnedIP(`https://localhost:${securePort}`, '127.0.0.1', options)
          ).text()
        ).toBe('tls reached')
        await expect(transport.fetch(`https://127.0.0.1:${securePort}`)).rejects.toThrow()
        await expect(
          transport.fetch(`https://127.0.0.1:${securePort}`, {
            headers: { host: `localhost:${securePort}` },
          })
        ).rejects.toThrow()
        await expect(
          secureFetchWithPinnedIP(`https://127.0.0.1:${securePort}`, '127.0.0.1', options)
        ).rejects.toThrow()
      })
    } finally {
      await transport.dispatcher.destroy()
    }
  })
  it('preserves Request bodies, encodes multipart data, and honors manual redirects', async () => {
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', options)
    try {
      await runWithOutboundOrganization('org_a', async () => {
        expect(
          await (
            await transport.fetch(new Request(url(), { method: 'POST', body: 'request body' }))
          ).text()
        ).toBe('request body')
        const form = new FormData()
        form.set('field', 'multipart body')
        expect(
          await (await transport.fetch(url(), { method: 'POST', body: form })).text()
        ).toContain('multipart body')
        const redirect = await transport.fetch(`${url()}/redirect`, { redirect: 'manual' })
        expect(redirect.status).toBe(302)
        await redirect.body?.cancel()
      })
    } finally {
      await transport.dispatcher.destroy()
    }
  })
  it('fails closed on denied proxy credentials without contacting the origin', async () => {
    state.gateways.set('denied', { ...state.gateways.get('org_a')!, token: 'denied' })
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', options)
    const start = originRequests
    try {
      await runWithOutboundOrganization('denied', async () => {
        await expect(transport.fetch(url())).rejects.toThrow()
        await expect(secureFetchWithPinnedIP(url(), '127.0.0.1', options)).rejects.toThrow()
      })
      expect(originRequests).toBe(start)
    } finally {
      await transport.dispatcher.destroy()
    }
  })
  it('routes a cached AWS SDK handler separately for each organization', async () => {
    const handler = createOutboundAwsHttpHandler()
    const start = admissions.length
    try {
      for (const id of ['org_a', 'org_b']) {
        await runWithOutboundOrganization(id, async () => {
          const { response } = await handler.handle({
            protocol: 'https:',
            hostname: 'localhost',
            port: securePort,
            method: 'GET',
            path: '/',
            headers: {},
            query: {},
          })
          const chunks: Buffer[] = []
          for await (const chunk of response.body) chunks.push(Buffer.from(chunk))
          expect(Buffer.concat(chunks).toString()).toBe('tls reached')
        })
      }
      expect(admissions.slice(start).map((item) => item.token)).toEqual([
        'Bearer alpha',
        'Bearer bravo',
      ])
    } finally {
      handler.destroy()
    }
  })

  it('routes and verifies TLS under the actual Bun runtime', async () => {
    const start = admissions.length
    await promisify(execFile)(
      'bun',
      [
        '--no-env-file',
        'run',
        fileURLToPath(new URL('./fixtures/gateway-runtime.fixture.ts', import.meta.url)),
        String((proxy.address() as AddressInfo).port),
        String(securePort),
        certificatePath,
      ],
      {
        timeout: 15_000,
        env: {
          ...process.env,
          /** This local tunnel fixture must not inherit hosted-mode loopback restrictions. */
          NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
          NEXT_PUBLIC_FORCE_HOSTED: 'false',
          NODE_EXTRA_CA_CERTS: certificatePath,
          OUTBOUND_ROUTING_SOURCE: 'env',
          OUTBOUND_ROUTING_CONFIG: JSON.stringify({
            schemaVersion: 1,
            revision: 'test',
            defaultRoute: { kind: 'blocked' },
            organizations: { org_test: { kind: 'gateway', gatewayId: 'synthetic' } },
          }),
          OUTBOUND_GATEWAYS: JSON.stringify({
            synthetic: {
              url: `https://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
              servername: 'gateway.invalid',
              credentialId: 'synthetic',
              generation: 'test',
            },
          }),
          OUTBOUND_GATEWAY_CREDENTIALS: JSON.stringify({
            synthetic: { token: 'a'.repeat(48), ca: cert },
          }),
        },
      }
    )
    expect(admissions.length).toBe(start + 4)
    expect(
      admissions.slice(start).every((entry) => entry.token === `Bearer ${'a'.repeat(48)}`)
    ).toBe(true)
  })

  it('supports cancellation without a direct retry', async () => {
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', options)
    const controller = new AbortController()
    try {
      const promise = runWithOutboundOrganization('org_a', () =>
        transport.fetch(`${url()}/wait`, { signal: controller.signal })
      )
      controller.abort()
      await expect(promise).rejects.toThrow()
    } finally {
      await transport.dispatcher.destroy()
    }
  })
})
