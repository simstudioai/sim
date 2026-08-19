/**
 * @vitest-environment node
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/security/dns', () => ({
  resolveHostAddresses: async () => ({
    addresses: ['127.0.0.1'],
    preferred: '127.0.0.1',
  }),
  preferIpv4: (addresses: string[]) => addresses[0],
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isHosted: false,
  isPrivateDatabaseHostsAllowed: false,
  getProxyUrl: () => undefined,
}))

import {
  DEFAULT_MAX_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
} from '@/lib/core/security/input-validation.server'

const servers: http.Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

/** Starts a throwaway loopback server and returns its origin. */
async function startServer(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

describe('secureFetchWithPinnedIP response cap', () => {
  it('rejects a body that exceeds an explicit cap instead of buffering it', async () => {
    const origin = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      // Chunked (no content-length), so only the streaming counter can catch it.
      for (let i = 0; i < 8; i++) res.write(Buffer.alloc(64 * 1024, 0x41))
      res.end()
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      maxResponseBytes: 64 * 1024,
    })

    await expect(response.text()).rejects.toThrow(/response body/i)
  })

  it('rejects a content-length above the default cap when the caller passes no cap', async () => {
    const origin = await startServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(DEFAULT_MAX_RESPONSE_BYTES + 1),
      })
      res.end('{}')
    })

    await expect(secureFetchWithPinnedIP(origin, '127.0.0.1', {})).rejects.toThrow(/response body/i)
  })

  it('reads a body that fits under the default cap', async () => {
    const origin = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {})

    expect(await response.text()).toBe('{"ok":true}')
  })

  it('does not trip on a HEAD response advertising a size above the cap', async () => {
    const origin = await startServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(DEFAULT_MAX_RESPONSE_BYTES + 1),
      })
      res.end()
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', { method: 'HEAD' })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
  })

  it('does not trip on a 304 advertising a size above the cap', async () => {
    const origin = await startServer((_req, res) => {
      res.writeHead(304, { 'Content-Length': String(DEFAULT_MAX_RESPONSE_BYTES + 1) })
      res.end()
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {})

    expect(response.status).toBe(304)
  })
})

describe('secureFetchWithPinnedIP redirects', () => {
  it('blocks a cross-origin 307 before Plaid headers or an access token body can escape', async () => {
    let targetCalls = 0
    const targetOrigin = await startServer(async (request, response) => {
      targetCalls++
      await readRequestBody(request)
      response.end('{}')
    })
    const sourceOrigin = await startServer((request, response) => {
      request.resume()
      response.writeHead(307, { Location: `${targetOrigin}/steal` })
      response.end()
    })

    await expect(
      secureFetchWithPinnedIP(`${sourceOrigin}/start`, '127.0.0.1', {
        allowHttp: true,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PLAID-CLIENT-ID': 'client-secret-id',
          'PLAID-SECRET': 'top-secret',
        },
        body: JSON.stringify({ access_token: 'access-secret' }),
      })
    ).rejects.toThrow(/cross-origin redirect would forward a request body/)

    expect(targetCalls).toBe(0)
  })

  it('turns a cross-origin 302 POST into a bodyless GET with no caller headers', async () => {
    let received:
      | { body: string; clientId?: string; contentType?: string; method?: string; secret?: string }
      | undefined
    const targetOrigin = await startServer(async (request, response) => {
      received = {
        body: await readRequestBody(request),
        clientId: request.headers['plaid-client-id'] as string | undefined,
        contentType: request.headers['content-type'],
        method: request.method,
        secret: request.headers['plaid-secret'] as string | undefined,
      }
      response.end('{"ok":true}')
    })
    const sourceOrigin = await startServer((request, response) => {
      request.resume()
      response.writeHead(302, { Location: `${targetOrigin}/final` })
      response.end()
    })

    const response = await secureFetchWithPinnedIP(`${sourceOrigin}/start`, '127.0.0.1', {
      allowHttp: true,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PLAID-CLIENT-ID': 'client-secret-id',
        'PLAID-SECRET': 'top-secret',
      },
      body: JSON.stringify({ access_token: 'access-secret' }),
    })

    expect(await response.text()).toBe('{"ok":true}')
    expect(received).toEqual({
      body: '',
      clientId: undefined,
      contentType: undefined,
      method: 'GET',
      secret: undefined,
    })
  })

  it('preserves HEAD across a 303 while still stripping cross-origin caller headers', async () => {
    let received: { method?: string; secret?: string } | undefined
    const targetOrigin = await startServer((request, response) => {
      received = {
        method: request.method,
        secret: request.headers['plaid-secret'] as string | undefined,
      }
      response.end()
    })
    const sourceOrigin = await startServer((request, response) => {
      request.resume()
      response.writeHead(303, { Location: `${targetOrigin}/final` })
      response.end()
    })

    await secureFetchWithPinnedIP(`${sourceOrigin}/start`, '127.0.0.1', {
      allowHttp: true,
      method: 'HEAD',
      headers: { 'PLAID-SECRET': 'top-secret' },
    })

    expect(received).toEqual({ method: 'HEAD', secret: undefined })
  })

  it('preserves a same-origin 307 body and headers and cleans up each abort listener', async () => {
    let received: { body: string; clientId?: string; method?: string } | undefined
    const origin = await startServer(async (request, response) => {
      if (request.url === '/start') {
        request.resume()
        response.writeHead(307, { Location: '/final' })
        response.end()
        return
      }
      received = {
        body: await readRequestBody(request),
        clientId: request.headers['plaid-client-id'] as string | undefined,
        method: request.method,
      }
      response.end('{"ok":true}')
    })
    const controller = new AbortController()
    const addListener = vi.spyOn(controller.signal, 'addEventListener')
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')

    const response = await secureFetchWithPinnedIP(`${origin}/start`, '127.0.0.1', {
      allowHttp: true,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'PLAID-CLIENT-ID': 'client-id' },
      body: '{"safe":"same-origin"}',
      signal: controller.signal,
    })

    expect(await response.text()).toBe('{"ok":true}')
    expect(received).toEqual({
      body: '{"safe":"same-origin"}',
      clientId: 'client-id',
      method: 'POST',
    })
    expect(addListener.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(3)
    expect(removeListener.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(3)
  })

  it('aborts a redirected response body after headers arrive without leaking listeners', async () => {
    const targetOrigin = await startServer((request, response) => {
      request.resume()
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      const interval = setInterval(() => response.write('streaming'), 10)
      response.on('close', () => clearInterval(interval))
    })
    const sourceOrigin = await startServer((request, response) => {
      request.resume()
      response.writeHead(302, { Location: `${targetOrigin}/stream` })
      response.end()
    })
    const controller = new AbortController()
    const addListener = vi.spyOn(controller.signal, 'addEventListener')
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')

    const response = await secureFetchWithPinnedIP(`${sourceOrigin}/start`, '127.0.0.1', {
      allowHttp: true,
      signal: controller.signal,
    })
    const body = response.text()
    controller.abort(new Error('cancel redirected stream'))

    await expect(body).rejects.toThrow('cancel redirected stream')
    expect(addListener.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(3)
    expect(removeListener.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(3)
  })

  it('uses one timeout budget for an entire redirect chain', async () => {
    const targetOrigin = await startServer((request, response) => {
      request.resume()
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      const interval = setInterval(() => response.write('still streaming'), 20)
      const finish = setTimeout(() => {
        clearInterval(interval)
        response.end('done')
      }, 200)
      response.on('close', () => {
        clearInterval(interval)
        clearTimeout(finish)
      })
    })
    const sourceOrigin = await startServer((request, response) => {
      request.resume()
      setTimeout(() => {
        response.writeHead(302, { Location: `${targetOrigin}/slow` })
        response.end()
      }, 40)
    })
    const startedAt = Date.now()

    const response = await secureFetchWithPinnedIP(`${sourceOrigin}/start`, '127.0.0.1', {
      allowHttp: true,
      timeout: 100,
    })
    await expect(response.text()).rejects.toThrow('Request timed out after 100ms')

    expect(Date.now() - startedAt).toBeLessThan(150)
  })
})
