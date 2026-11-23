import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as httpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { type AddressInfo, connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3'
import { networkConfigMock } from '@sim/testing/mocks/network-config.mock'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/network/config.server', () => networkConfigMock)
vi.mock('@sim/security/dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sim/security/dns')>()
  const records: Record<string, [string, ...string[]]> = {
    'origin.invalid': ['1.1.1.1', '93.184.216.34'],
    'internal.invalid': ['10.0.0.5'],
    'split.invalid': ['93.184.216.34', '169.254.169.254'],
  }
  return {
    ...actual,
    resolveHostAddresses: async (host: string) => {
      const addresses = records[host]
      if (!addresses) throw new Error(`No addresses for ${host}`)
      return { addresses, preferred: addresses[0] }
    },
  }
})

import { resolveEnvironmentProxy } from '@sim/security/environment-proxy'
import { awsRequestHandler } from '@/lib/core/network/proxy-agent.server'
import {
  createPinnedFetchWithDispatcher,
  createSsrfGuardedFetchWithDispatcher,
  secureFetchWithPinnedIP,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'

const certificateDirectory = mkdtempSync(join(tmpdir(), 'environment-proxy-tls-'))
const certificatePath = join(certificateDirectory, 'cert.pem')
const keyPath = join(certificateDirectory, 'key.pem')
const sockets = new Set<Socket>()
const tunnels: Array<{ authority: string | undefined; authorization: string | undefined }> = []
const forwarded: Array<{ url: string | undefined; authorization: string | undefined }> = []
const proxiedPorts = new Set<number>()
let originHeaders: Record<string, unknown> = {}

const secureOrigin = httpsServer((req, res) => {
  originHeaders = req.headers
  res.setHeader('x-via-proxy', proxiedPorts.has(req.socket.remotePort ?? 0) ? 'yes' : 'no')
  if (req.url === '/to-internal') {
    res.writeHead(302, { location: 'https://internal.invalid/' })
    res.end()
    return
  }
  if (String(req.headers.authorization).startsWith('AWS4-HMAC-SHA256')) {
    res.setHeader('content-type', 'application/xml')
    res.end('<ListAllMyBucketsResult><Buckets></Buckets></ListAllMyBucketsResult>')
    return
  }
  res.end('tls reached')
})

/** A forward proxy: CONNECT tunnels reach the TLS origin, absolute-form requests are answered here. */
function forwardRequest(req: IncomingMessage, res: ServerResponse) {
  forwarded.push({ url: req.url, authorization: req.headers['proxy-authorization'] })
  res.end('forwarded')
}
function tunnel(req: IncomingMessage, socket: Duplex, head: Buffer) {
  socket.on('error', () => {})
  tunnels.push({ authority: req.url, authorization: req.headers['proxy-authorization'] })
  const upstream = connect(securePort, '127.0.0.1', () => {
    if (upstream.localPort) proxiedPorts.add(upstream.localPort)
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('close', () => upstream.destroy())
  sockets.add(upstream)
  upstream.on('close', () => sockets.delete(upstream))
}
const proxy = httpServer(forwardRequest)
proxy.on('connect', tunnel)
const tlsProxy = httpsServer(forwardRequest)
tlsProxy.on('connect', tunnel)

let securePort = 0
let proxyUrl = ''
let tlsProxyUrl = ''
const trust = getCACertificates('default')
const PROXY_ENV = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy']
const options = { profile: 'contentFetch' as const, timeout: 10_000 }

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
    '/CN=origin.invalid',
    '-addext',
    'subjectAltName=DNS:origin.invalid,IP:1.1.1.1,IP:127.0.0.1',
    '-addext',
    'extendedKeyUsage=serverAuth',
  ])
  const cert = readFileSync(certificatePath, 'utf8')
  const key = readFileSync(keyPath, 'utf8')
  for (const server of [secureOrigin, tlsProxy]) server.setSecureContext({ cert, key })
  setDefaultCACertificates([...trust, cert])
  for (const server of [secureOrigin, proxy, tlsProxy]) {
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  }
  securePort = (secureOrigin.address() as AddressInfo).port
  proxyUrl = `http://sim:proxy-secret@127.0.0.1:${(proxy.address() as AddressInfo).port}`
  tlsProxyUrl = `https://sim:proxy-secret@127.0.0.1:${(tlsProxy.address() as AddressInfo).port}`
})

beforeEach(() => {
  for (const name of PROXY_ENV) vi.stubEnv(name, '')
  vi.stubEnv('HTTPS_PROXY', proxyUrl)
  vi.stubEnv('HTTP_PROXY', proxyUrl)
  tunnels.length = 0
  forwarded.length = 0
  originHeaders = {}
})

afterAll(async () => {
  for (const socket of sockets) socket.destroy()
  await Promise.all(
    [secureOrigin, proxy, tlsProxy].map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  )
  setDefaultCACertificates(trust)
  rmSync(certificateDirectory, { recursive: true, force: true })
})

const PROXY_AUTHORIZATION = `Basic ${Buffer.from('sim:proxy-secret').toString('base64')}`

describe('guarded requests under HTTPS_PROXY', () => {
  it('tunnels a validated request by hostname and keeps proxy credentials off the origin', async () => {
    const response = await secureFetchWithValidation('https://origin.invalid/discovery', {
      ...options,
      headers: { 'Proxy-Authorization': 'must-not-reach-origin' },
    })
    expect(await response.text()).toBe('tls reached')
    expect(response.headers.get('x-via-proxy')).toBe('yes')
    expect(tunnels).toEqual([
      { authority: 'origin.invalid:443', authorization: PROXY_AUTHORIZATION },
    ])
    expect(originHeaders['proxy-authorization']).toBeUndefined()
    expect(originHeaders.host).toBe('origin.invalid')
  })

  it('tunnels pinned and DNS-guarded fetches', async () => {
    const pinned = createPinnedFetchWithDispatcher('1.1.1.1', options)
    const guarded = createSsrfGuardedFetchWithDispatcher(options)
    try {
      expect(await (await pinned.fetch('https://origin.invalid/')).text()).toBe('tls reached')
      expect(await (await guarded.fetch('https://origin.invalid/')).text()).toBe('tls reached')
      expect(tunnels.map((tunnel) => tunnel.authority)).toEqual([
        'origin.invalid:443',
        'origin.invalid:443',
      ])
    } finally {
      await Promise.all([pinned.dispatcher.destroy(), guarded.dispatcher.destroy()])
    }
  })

  it('tunnels through an https:// proxy, verifying the proxy certificate', async () => {
    vi.stubEnv('HTTPS_PROXY', tlsProxyUrl)
    const response = await secureFetchWithValidation('https://origin.invalid/', options)
    expect(await response.text()).toBe('tls reached')
    expect(tunnels).toEqual([
      { authority: 'origin.invalid:443', authorization: PROXY_AUTHORIZATION },
    ])
  })

  it('forwards plain-http destinations in absolute form instead of tunneling', async () => {
    const response = await secureFetchWithPinnedIP('http://origin.invalid/plain', '1.1.1.1', {
      ...options,
      profile: 'selfHostedService',
    })
    expect(await response.text()).toBe('forwarded')
    expect(tunnels).toEqual([])
    expect(forwarded).toEqual([
      { url: 'http://origin.invalid/plain', authorization: PROXY_AUTHORIZATION },
    ])
  })

  it('caps a forwarded plain-http response at maxResponseSize', async () => {
    const guarded = createSsrfGuardedFetchWithDispatcher({
      ...options,
      profile: 'selfHostedService',
      maxResponseSize: 4,
    })
    try {
      const response = await guarded.fetch('http://origin.invalid/plain')
      await expect(response.text()).rejects.toMatchObject({
        code: 'UND_ERR_RES_EXCEEDED_MAX_SIZE',
      })
    } finally {
      await guarded.dispatcher.destroy()
    }
    expect(forwarded).toEqual([
      { url: 'http://origin.invalid/plain', authorization: PROXY_AUTHORIZATION },
    ])
  })

  it('connects directly, still pinned, when NO_PROXY names the host', async () => {
    vi.stubEnv('NO_PROXY', 'localhost,.invalid')
    const response = await secureFetchWithPinnedIP(
      `https://origin.invalid:${securePort}/`,
      '127.0.0.1',
      options
    )
    expect(await response.text()).toBe('tls reached')
    expect(response.headers.get('x-via-proxy')).toBe('no')
    expect(tunnels).toEqual([])
  })

  it('refuses a destination that resolves to a blocked address without asking the proxy', async () => {
    const guarded = createSsrfGuardedFetchWithDispatcher(options)
    try {
      await expect(guarded.fetch('https://internal.invalid/')).rejects.toThrow(/private|blocked/i)
      await expect(
        secureFetchWithPinnedIP('https://internal.invalid/', '1.1.1.1', options)
      ).rejects.toThrow(/private|blocked/i)
    } finally {
      await guarded.dispatcher.destroy()
    }
    expect(tunnels).toEqual([])
  })

  it('refuses a name with any blocked record, since the proxy may dial any of them', async () => {
    const guarded = createSsrfGuardedFetchWithDispatcher(options)
    try {
      await expect(guarded.fetch('https://split.invalid/')).rejects.toThrow(/metadata/i)
      await expect(secureFetchWithValidation('https://split.invalid/', options)).rejects.toThrow(
        /metadata/i
      )
    } finally {
      await guarded.dispatcher.destroy()
    }
    expect(tunnels).toEqual([])

    const response = await secureFetchWithValidation('https://origin.invalid/', options)
    expect(await response.text()).toBe('tls reached')
    expect(tunnels.map((tunnel) => tunnel.authority)).toEqual(['origin.invalid:443'])
  })

  it('judges each redirect hop again before proxying it', async () => {
    const pinned = createPinnedFetchWithDispatcher('1.1.1.1', options)
    try {
      await expect(pinned.fetch('https://origin.invalid/to-internal')).rejects.toThrow(
        /private|blocked/i
      )
      await expect(
        secureFetchWithPinnedIP('https://origin.invalid/to-internal', '1.1.1.1', options)
      ).rejects.toThrow(/private|blocked/i)
    } finally {
      await pinned.dispatcher.destroy()
    }
    expect(tunnels.map((tunnel) => tunnel.authority)).toEqual([
      'origin.invalid:443',
      'origin.invalid:443',
    ])
  })

  it('tunnels guarded fetches and AWS SDK requests under the actual Bun runtime', async () => {
    await promisify(execFile)(
      'bun',
      [
        '--no-env-file',
        'run',
        fileURLToPath(new URL('./fixtures/environment-proxy-runtime.fixture.ts', import.meta.url)),
      ],
      {
        timeout: 15_000,
        env: {
          ...process.env,
          NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
          NEXT_PUBLIC_FORCE_HOSTED: 'false',
          NODE_EXTRA_CA_CERTS: certificatePath,
          HTTPS_PROXY: proxyUrl,
          https_proxy: '',
          NO_PROXY: '',
          no_proxy: '',
        },
      }
    )
    expect(tunnels).toEqual([
      { authority: '1.1.1.1:443', authorization: PROXY_AUTHORIZATION },
      { authority: '1.1.1.1:443', authorization: PROXY_AUTHORIZATION },
    ])
  })
})

describe('proxy selection from the environment', () => {
  it.each([
    {
      case: 'an empty lowercase variable does not hide the uppercase one',
      env: { https_proxy: '', HTTPS_PROXY: 'http://upper:3128' },
      target: 'https://api.example.com/',
      proxy: 'http://upper:3128/',
    },
    {
      case: 'an https destination falls back to HTTP_PROXY',
      env: { HTTP_PROXY: 'http://plain:3128' },
      target: 'https://api.example.com/',
      proxy: 'http://plain:3128/',
    },
    {
      case: 'a bare host:port is read as an http proxy',
      env: { HTTPS_PROXY: 'proxy.internal:3128' },
      target: 'https://api.example.com/',
      proxy: 'http://proxy.internal:3128/',
    },
    {
      case: 'a NO_PROXY entry with a port only excludes that port',
      env: { HTTPS_PROXY: 'http://p:3128', NO_PROXY: 'api.example.com:8443' },
      target: 'https://api.example.com/',
      proxy: 'http://p:3128/',
    },
    {
      case: 'a bare NO_PROXY domain also excludes its subdomains',
      env: { HTTPS_PROXY: 'http://p:3128', NO_PROXY: 'example.com' },
      target: 'https://api.example.com/',
      proxy: null,
    },
    {
      case: 'a leading-dot NO_PROXY domain also excludes the apex',
      env: { HTTPS_PROXY: 'http://p:3128', NO_PROXY: '.example.com' },
      target: 'https://example.com/',
      proxy: null,
    },
    {
      case: 'a NO_PROXY domain does not match a longer name that merely ends with it',
      env: { HTTPS_PROXY: 'http://p:3128', NO_PROXY: 'example.com' },
      target: 'https://notexample.com/',
      proxy: 'http://p:3128/',
    },
    {
      case: 'a bare IPv6 NO_PROXY entry excludes that address',
      env: { HTTP_PROXY: 'http://p:3128', NO_PROXY: 'localhost,::1' },
      target: 'http://[::1]:3000/',
      proxy: null,
    },
    {
      case: 'an IPv6 NO_PROXY entry matches any spelling of the address',
      env: { HTTP_PROXY: 'http://p:3128', NO_PROXY: '0:0:0:0:0:0:0:1' },
      target: 'http://[::1]/',
      proxy: null,
    },
    {
      case: 'a bracketed IPv6 NO_PROXY entry with a port only excludes that port',
      env: { HTTP_PROXY: 'http://p:3128', NO_PROXY: '[::1]:3000' },
      target: 'http://[::1]:4000/',
      proxy: 'http://p:3128/',
    },
    {
      case: 'an IPv4 CIDR NO_PROXY entry excludes addresses inside the range',
      env: { HTTPS_PROXY: 'http://p:3128', NO_PROXY: '10.0.0.0/8' },
      target: 'https://10.20.30.40/',
      proxy: null,
    },
    {
      case: 'an IPv4 CIDR NO_PROXY entry leaves addresses outside the range proxied',
      env: { HTTPS_PROXY: 'http://p:3128', NO_PROXY: '10.0.0.0/8' },
      target: 'https://11.0.0.1/',
      proxy: 'http://p:3128/',
    },
    {
      case: 'a malformed CIDR NO_PROXY entry is ignored rather than read as its first prefix',
      env: { HTTPS_PROXY: 'http://p:3128', NO_PROXY: '10.0.0.0/8/junk' },
      target: 'https://10.20.30.40/',
      proxy: 'http://p:3128/',
    },
    {
      case: 'an IPv6 CIDR NO_PROXY entry excludes addresses inside the range',
      env: { HTTP_PROXY: 'http://p:3128', NO_PROXY: 'fd00::/8' },
      target: 'http://[fd12::1]/',
      proxy: null,
    },
    {
      case: 'an empty lowercase no_proxy does not hide the uppercase one',
      env: { HTTPS_PROXY: 'http://p:3128', no_proxy: '', NO_PROXY: 'example.com' },
      target: 'https://example.com/',
      proxy: null,
    },
    {
      case: 'NO_PROXY=* excludes every destination',
      env: { HTTPS_PROXY: 'http://p:3128', NO_PROXY: '*' },
      target: 'https://api.example.com/',
      proxy: null,
    },
  ])('$case', ({ env, target, proxy }) => {
    for (const name of PROXY_ENV) vi.stubEnv(name, '')
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    expect(resolveEnvironmentProxy(new URL(target))).toBe(proxy)
  })

  it('fails closed instead of going direct when the proxy URL is unsupported', async () => {
    vi.stubEnv('HTTPS_PROXY', 'socks5://127.0.0.1:1080')
    await expect(secureFetchWithValidation('https://origin.invalid/', options)).rejects.toThrow(
      /http:\/\/ or https:\/\//
    )
    expect(tunnels).toEqual([])
    expect(originHeaders).toEqual({})
  })
})

describe('AWS SDK clients under HTTPS_PROXY', () => {
  const listBuckets = (endpoint: string) =>
    new S3Client({
      region: 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
      requestHandler: awsRequestHandler(),
    }).send(new ListBucketsCommand({}))

  it('tunnels SDK requests by hostname and keeps proxy credentials off the origin', async () => {
    await expect(listBuckets('https://origin.invalid')).resolves.toMatchObject({ Buckets: [] })
    expect(tunnels).toEqual([
      { authority: 'origin.invalid:443', authorization: PROXY_AUTHORIZATION },
    ])
    expect(originHeaders['proxy-authorization']).toBeUndefined()
  })

  it('connects directly when NO_PROXY names the endpoint', async () => {
    vi.stubEnv('NO_PROXY', '127.0.0.1')
    await expect(listBuckets(`https://127.0.0.1:${securePort}`)).resolves.toMatchObject({
      Buckets: [],
    })
    expect(tunnels).toEqual([])
  })

  it('leaves the SDK defaults untouched when no proxy is configured', () => {
    vi.stubEnv('HTTPS_PROXY', '')
    vi.stubEnv('HTTP_PROXY', '')
    expect(awsRequestHandler({ requestTimeout: 10_000 })).not.toBeInstanceOf(NodeHttpHandler)
    expect(awsRequestHandler()).toBeUndefined()
  })
})
