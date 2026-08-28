/**
 * Pins both outbound redirect contracts: historical replay for persisted workflows and
 * standards-compatible behavior for newly created API blocks.
 *
 * @vitest-environment node
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/security/dns', () => ({
  resolveHostAddresses: vi.fn(async () => ({ addresses: ['127.0.0.1'] })),
  preferIpv4: (addresses: string[]) => addresses[0],
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isHosted: false,
  getEgressAllowedHosts: () => undefined,
  getEgressAllowedIpRanges: () => undefined,
  isLegacyPrivateDatabaseAccessAllowed: () => false,
  getProxyUrl: () => undefined,
}))

import { secureFetchWithPinnedIP } from '@/lib/core/security/input-validation.server'

interface RecordedHop {
  method: string
  body: string
  headers: http.IncomingHttpHeaders
}

const servers: http.Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

async function startServer(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** Records every request it receives, then answers 200. */
async function startRecordingServer(hops: RecordedHop[]): Promise<string> {
  return startServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      hops.push({ method: req.method ?? '', body, headers: req.headers })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
}

describe('secureFetchWithPinnedIP redirect replay', () => {
  it('rejects a redirect target before following it', async () => {
    const hops: RecordedHop[] = []
    const target = await startRecordingServer(hops)
    const origin = await startServer((req, res) => {
      req.resume()
      res.writeHead(302, { location: `${target}/after` })
      res.end()
    })
    const assertRedirectTarget = vi.fn((url: string) => {
      if (url === `${target}/after`) throw new Error('redirect target rejected')
    })

    await expect(
      secureFetchWithPinnedIP(origin, '127.0.0.1', {
        profile: 'configuredEndpoint',
        assertRedirectTarget,
      })
    ).rejects.toThrow('redirect target rejected')

    expect(assertRedirectTarget).toHaveBeenCalledWith(`${target}/after`)
    expect(hops).toEqual([])
  })

  it('preserves historical replay when no redirect policy is present', async () => {
    const hops: RecordedHop[] = []
    const target = await startRecordingServer(hops)
    const origin = await startServer((req, res) => {
      req.resume()
      res.writeHead(303, { location: `${target}/after` })
      res.end()
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      method: 'POST',
      body: '{"message":"legacy"}',
      headers: {
        Authorization: 'Bearer legacy-token',
        'Content-Type': 'application/json',
        Host: 'legacy.example',
      },
      profile: 'configuredEndpoint',
    })

    expect(response.status).toBe(200)
    expect(hops).toHaveLength(1)
    expect(hops[0].method).toBe('POST')
    expect(hops[0].body).toBe('{"message":"legacy"}')
    expect(hops[0].headers.authorization).toBe('Bearer legacy-token')
    expect(hops[0].headers.host).toBe('legacy.example')
  })

  it('lets a legacy block withhold credentials without changing its replay semantics', async () => {
    const hops: RecordedHop[] = []
    const target = await startRecordingServer(hops)
    const origin = await startServer((req, res) => {
      req.resume()
      res.writeHead(303, { location: `${target}/after` })
      res.end()
    })

    await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      method: 'POST',
      body: '{"message":"legacy"}',
      headers: {
        Authorization: 'Bearer strip-me',
        'Content-Type': 'application/json',
        'X-Api-Key': 'strip-me-too',
        'X-Trace': 'keep-me',
      },
      redirectPolicy: {
        mode: 'legacy',
        sendCredentialsOnCrossOriginRedirect: false,
        sensitiveHeaders: ['x-api-key'],
      },
      profile: 'configuredEndpoint',
    })

    expect(hops).toHaveLength(1)
    expect(hops[0].method).toBe('POST')
    expect(hops[0].body).toBe('{"message":"legacy"}')
    expect(hops[0].headers.authorization).toBeUndefined()
    expect(hops[0].headers['x-api-key']).toBeUndefined()
    expect(hops[0].headers['content-type']).toBe('application/json')
    expect(hops[0].headers['x-trace']).toBe('keep-me')
  })

  it('uses Fetch-compatible POST handling for a standard 303', async () => {
    const hops: RecordedHop[] = []
    const target = await startRecordingServer(hops)
    const origin = await startServer((req, res) => {
      req.resume()
      res.writeHead(303, { location: `${target}/after` })
      res.end()
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      method: 'POST',
      body: '{"message":"standard"}',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
        Host: 'origin.example',
        'X-Api-Key': 'secret-key',
        'X-Trace': 'keep-me',
      },
      redirectPolicy: {
        mode: 'standard',
        sendCredentialsOnCrossOriginRedirect: false,
        sensitiveHeaders: ['x-api-key'],
      },
      profile: 'configuredEndpoint',
    })

    expect(response.status).toBe(200)
    expect(hops).toHaveLength(1)
    expect(hops[0].method).toBe('GET')
    expect(hops[0].body).toBe('')
    expect(hops[0].headers.authorization).toBeUndefined()
    expect(hops[0].headers['content-type']).toBeUndefined()
    expect(hops[0].headers['content-length']).toBeUndefined()
    expect(hops[0].headers['content-language']).toBeUndefined()
    expect(hops[0].headers['x-api-key']).toBeUndefined()
    expect(hops[0].headers['x-trace']).toBe('keep-me')
    expect(hops[0].headers.host).not.toBe('origin.example')
  })

  it('changes a standard POST to a bodyless GET on 301', async () => {
    const hops: RecordedHop[] = []
    const target = await startRecordingServer(hops)
    const origin = await startServer((req, res) => {
      req.resume()
      res.writeHead(301, { location: `${target}/after` })
      res.end()
    })

    await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      method: 'POST',
      body: '{"message":"standard"}',
      headers: {
        'Content-Type': 'application/json',
        'Content-Language': 'en',
      },
      redirectPolicy: {
        mode: 'standard',
        sendCredentialsOnCrossOriginRedirect: false,
      },
      profile: 'configuredEndpoint',
    })

    expect(hops).toHaveLength(1)
    expect(hops[0].method).toBe('GET')
    expect(hops[0].body).toBe('')
    expect(hops[0].headers['content-type']).toBeUndefined()
    expect(hops[0].headers['content-language']).toBeUndefined()
  })

  it('keeps HEAD as HEAD on a standard 303', async () => {
    const hops: RecordedHop[] = []
    const target = await startRecordingServer(hops)
    const origin = await startServer((req, res) => {
      req.resume()
      res.writeHead(303, { location: `${target}/after` })
      res.end()
    })

    await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      method: 'HEAD',
      redirectPolicy: {
        mode: 'standard',
        sendCredentialsOnCrossOriginRedirect: false,
      },
      profile: 'configuredEndpoint',
    })

    expect(hops).toHaveLength(1)
    expect(hops[0].method).toBe('HEAD')
  })

  it('preserves a standard 307 body while withholding cross-origin credentials', async () => {
    const hops: RecordedHop[] = []
    const target = await startRecordingServer(hops)
    const origin = await startServer((req, res) => {
      req.resume()
      res.writeHead(307, { location: `${target}/after` })
      res.end()
    })

    await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      method: 'POST',
      body: '{"payload":"keep"}',
      headers: {
        Authorization: 'Bearer strip-me',
        'Content-Type': 'application/json',
        'X-Trace': 'keep-me',
      },
      redirectPolicy: {
        mode: 'standard',
        sendCredentialsOnCrossOriginRedirect: false,
      },
      profile: 'configuredEndpoint',
    })

    expect(hops).toHaveLength(1)
    expect(hops[0].method).toBe('POST')
    expect(hops[0].body).toBe('{"payload":"keep"}')
    expect(hops[0].headers.authorization).toBeUndefined()
    expect(hops[0].headers['content-type']).toBe('application/json')
    expect(hops[0].headers['x-trace']).toBe('keep-me')
  })

  it('allows an explicit standard-policy credential opt-in', async () => {
    const hops: RecordedHop[] = []
    const target = await startRecordingServer(hops)
    const origin = await startServer((req, res) => {
      req.resume()
      res.writeHead(307, { location: `${target}/after` })
      res.end()
    })

    await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      method: 'POST',
      body: '{"payload":"keep"}',
      headers: { Authorization: 'Bearer keep-me', Host: 'origin.example' },
      redirectPolicy: {
        mode: 'standard',
        sendCredentialsOnCrossOriginRedirect: true,
      },
      profile: 'configuredEndpoint',
    })

    expect(hops).toHaveLength(1)
    expect(hops[0].headers.authorization).toBe('Bearer keep-me')
    expect(hops[0].headers.host).not.toBe('origin.example')
  })

  it('preserves method, body and headers on a same-origin standard 307', async () => {
    const hops: RecordedHop[] = []
    let redirected = false
    const origin = await startServer((req, res) => {
      if (!redirected) {
        redirected = true
        req.resume()
        res.writeHead(307, { location: '/after' })
        res.end()
        return
      }
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        hops.push({ method: req.method ?? '', body, headers: req.headers })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
      })
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      method: 'POST',
      body: '{"keep":"me"}',
      headers: { Authorization: 'Bearer same-origin-ok' },
      redirectPolicy: {
        mode: 'standard',
        sendCredentialsOnCrossOriginRedirect: false,
      },
      profile: 'configuredEndpoint',
    })

    expect(response.status).toBe(200)
    expect(hops).toHaveLength(1)
    expect(hops[0].method).toBe('POST')
    expect(hops[0].body).toBe('{"keep":"me"}')
    expect(hops[0].headers.authorization).toBe('Bearer same-origin-ok')
  })

  it('honours stripAuthOnRedirect on a same-origin hop', async () => {
    const hops: RecordedHop[] = []
    let redirected = false
    const origin = await startServer((req, res) => {
      if (!redirected) {
        redirected = true
        req.resume()
        res.writeHead(302, { location: '/after' })
        res.end()
        return
      }
      req.resume()
      req.on('end', () => {
        hops.push({ method: req.method ?? '', body: '', headers: req.headers })
        res.writeHead(200, {})
        res.end('ok')
      })
    })

    await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      method: 'GET',
      headers: { Authorization: 'Bearer strip-me', 'X-Trace': 'keep-me' },
      stripAuthOnRedirect: true,
      profile: 'configuredEndpoint',
    })

    expect(hops).toHaveLength(1)
    expect(hops[0].headers.authorization).toBeUndefined()
    expect(hops[0].headers['x-trace']).toBe('keep-me')
  })
})
