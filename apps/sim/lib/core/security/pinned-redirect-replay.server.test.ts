/**
 * `secureFetchWithPinnedIP` used to hand `options` straight to its redirect recursion, so a
 * 301/302/303 replayed the original method and body — delivering a non-idempotent write twice —
 * and forwarded `Authorization` and every other caller header to whatever origin the upstream
 * named. `followRedirectsGuarded` had the correct rules in the same file; the two had drifted.
 * Both now share `resolveRedirectHop`, and these tests pin the behaviour that drift broke.
 *
 * Distinct loopback ports are distinct origins, which is what makes the cross-origin cases
 * testable without leaving 127.0.0.1.
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
  isPrivateDatabaseHostsAllowed: false,
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
  it('degrades a POST to a bodyless GET on 303 instead of replaying the write', async () => {
    const hops: RecordedHop[] = []
    const target = await startRecordingServer(hops)
    const origin = await startServer((req, res) => {
      req.resume()
      res.writeHead(303, { location: `${target}/after` })
      res.end()
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      method: 'POST',
      body: '{"message":"do not send me twice"}',
      headers: { 'Content-Type': 'application/json' },
      allowHttp: true,
    })

    expect(response.status).toBe(200)
    expect(hops).toHaveLength(1)
    expect(hops[0].method).toBe('GET')
    expect(hops[0].body).toBe('')
    // The entity headers that described the removed body must not survive it.
    expect(hops[0].headers['content-type']).toBeUndefined()
    expect(hops[0].headers['content-length']).toBeUndefined()
  })

  it('degrades a POST to a bodyless GET on 302', async () => {
    const hops: RecordedHop[] = []
    const target = await startRecordingServer(hops)
    const origin = await startServer((req, res) => {
      req.resume()
      res.writeHead(302, { location: `${target}/after` })
      res.end()
    })

    await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      method: 'POST',
      body: '{"charge":"once"}',
      allowHttp: true,
    })

    expect(hops).toHaveLength(1)
    expect(hops[0].method).toBe('GET')
    expect(hops[0].body).toBe('')
  })

  it('drops every caller header on a cross-origin hop, not just Authorization', async () => {
    const hops: RecordedHop[] = []
    const target = await startRecordingServer(hops)
    const origin = await startServer((req, res) => {
      req.resume()
      res.writeHead(302, { location: `${target}/after` })
      res.end()
    })

    await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      method: 'GET',
      headers: { Authorization: 'Bearer secret-token', 'X-Api-Key': 'secret-key' },
      allowHttp: true,
    })

    expect(hops).toHaveLength(1)
    expect(hops[0].headers.authorization).toBeUndefined()
    expect(hops[0].headers['x-api-key']).toBeUndefined()
  })

  it('refuses a cross-origin 307 that would forward the request body', async () => {
    const hops: RecordedHop[] = []
    const target = await startRecordingServer(hops)
    const origin = await startServer((req, res) => {
      req.resume()
      res.writeHead(307, { location: `${target}/after` })
      res.end()
    })

    await expect(
      secureFetchWithPinnedIP(origin, '127.0.0.1', {
        method: 'POST',
        body: '{"secret":"payload"}',
        allowHttp: true,
      })
    ).rejects.toThrow(/cross-origin redirect would forward a request body/i)

    // Refused before dialing: the write never reached the redirect target.
    expect(hops).toHaveLength(0)
  })

  it('preserves method, body and headers on a same-origin 307', async () => {
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
      allowHttp: true,
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
      allowHttp: true,
    })

    expect(hops).toHaveLength(1)
    expect(hops[0].headers.authorization).toBeUndefined()
    expect(hops[0].headers['x-trace']).toBe('keep-me')
  })
})
