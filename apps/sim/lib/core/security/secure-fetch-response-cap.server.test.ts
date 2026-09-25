import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Transform } from 'node:stream'
import zlib, { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { Agent } from 'undici/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/security/dns', () => ({
  resolveHostAddresses: vi.fn(),
  preferIpv4: (addresses: string[]) => addresses[0],
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isHosted: false,
  getEgressAllowedHosts: () => undefined,
  getEgressAllowedIpRanges: () => undefined,
  isLegacyPrivateDatabaseAccessAllowed: () => false,
  getProxyUrl: () => undefined,
}))

import * as networkTransport from '@/lib/core/network/transport.server'
import {
  createPinnedFetchWithDispatcher,
  DEFAULT_MAX_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
} from '@/lib/core/security/input-validation.server'

const servers: http.Server[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    server.close()
  }
})

/** Starts a throwaway loopback server and returns its origin. */
async function startServer(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('secureFetchWithPinnedIP response cap', () => {
  it.each(['direct', 'gateway'])(
    'preserves the status phrase and active streaming past the %s inactivity timeout',
    async (mode) => {
      const dispatcher = new Agent()
      if (mode === 'gateway') {
        vi.spyOn(networkTransport, 'createOutboundTransport').mockReturnValue({
          selectDispatcher: async () => dispatcher,
          close: () => dispatcher.close(),
          destroy: () => dispatcher.destroy(),
        })
      }
      const origin = await startServer((_req, res) => {
        res.writeHead(200, 'Synthetic status phrase')
        res.write('start')
        let chunks = 0
        const timer = setInterval(() => {
          res.write('.')
          if (++chunks === 25) {
            clearInterval(timer)
            res.end()
          }
        }, 50)
        res.once('close', () => clearInterval(timer))
      })

      try {
        const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
          profile: 'configuredEndpoint',
          timeout: 1000,
        })
        expect(response.statusText).toBe('Synthetic status phrase')
        await expect(response.text()).resolves.toBe(`start${'.'.repeat(25)}`)
      } finally {
        await dispatcher.destroy()
      }
    }
  )

  it.each([
    { encoding: 'gzip', compress: gzipSync },
    { encoding: 'deflate', compress: deflateSync },
    { encoding: 'br', compress: brotliCompressSync },
  ])(
    'decodes $encoding JSON and removes encoded framing headers',
    async ({ encoding, compress }) => {
      const payload = { ok: true, message: 'compressed provider response' }
      const encoded = compress(Buffer.from(JSON.stringify(payload)))
      const origin = await startServer((_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Encoding': encoding,
          'Content-Length': String(encoded.length),
        })
        res.end(encoded)
      })

      const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
        profile: 'configuredEndpoint',
        maxResponseBytes: 1024,
      })

      await expect(response.json()).resolves.toEqual(payload)
      expect(response.headers.get('content-type')).toBe('application/json')
      expect(response.headers.get('content-encoding')).toBeNull()
      expect(response.headers.get('content-length')).toBeNull()
    }
  )

  it('limits decoded bytes and closes an upstream still sending compressed content', async () => {
    const closed = vi.fn()
    const encoded = gzipSync(Buffer.alloc(64 * 1024, 0x41))
    expect(encoded.length).toBeLessThan(1024)
    const origin = await startServer((_req, res) => {
      res.once('close', closed)
      res.writeHead(200, { 'Content-Encoding': 'gzip' })
      res.write(encoded)
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      profile: 'configuredEndpoint',
      maxResponseBytes: 1024,
    })

    await expect(response.text()).rejects.toThrow(/response body/i)
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
  })

  it('rejects malformed compression and closes the upstream connection', async () => {
    const closed = vi.fn()
    const origin = await startServer((_req, res) => {
      res.once('close', closed)
      res.writeHead(200, { 'Content-Encoding': 'gzip' })
      res.write('this is not gzip')
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      profile: 'configuredEndpoint',
    })

    await expect(response.text()).rejects.toThrow()
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
  })

  it('rejects a compressed body read when its request is aborted', async () => {
    const controller = new AbortController()
    const closed = vi.fn()
    const origin = await startServer((_req, res) => {
      res.once('close', closed)
      res.writeHead(200, { 'Content-Encoding': 'gzip' })
      res.write(gzipSync(Buffer.from('payload')).subarray(0, 10))
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      profile: 'configuredEndpoint',
      signal: controller.signal,
    })
    const body = response.text()
    controller.abort()

    await expect(body).rejects.toThrow()
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
  })

  it('destroys the compressed source when the reader cancels', async () => {
    const closed = vi.fn()
    const origin = await startServer((_req, res) => {
      res.once('close', closed)
      res.writeHead(200, { 'Content-Encoding': 'gzip' })
      res.write(gzipSync(Buffer.from('payload')))
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      profile: 'configuredEndpoint',
    })
    await response.body!.cancel()

    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
  })

  it.each([
    { method: 'HEAD', status: 200 },
    { method: 'GET', status: 304 },
  ])('does not decode a bodyless $method $status response', async ({ method, status }) => {
    const origin = await startServer((_req, res) => {
      res.writeHead(status, { 'Content-Encoding': 'gzip' })
      res.end()
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      profile: 'configuredEndpoint',
      method,
    })

    await expect(response.text()).resolves.toBe('')
    expect(response.headers.get('content-encoding')).toBe('gzip')
  })

  it('rejects a body that exceeds an explicit cap instead of buffering it', async () => {
    const origin = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      // Chunked (no content-length), so only the streaming counter can catch it.
      for (let i = 0; i < 8; i++) res.write(Buffer.alloc(64 * 1024, 0x41))
      res.end()
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      profile: 'configuredEndpoint',
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

    await expect(
      secureFetchWithPinnedIP(origin, '127.0.0.1', { profile: 'configuredEndpoint' })
    ).rejects.toThrow(/response body/i)
  })

  it('does not trip on a HEAD response advertising a size above the cap', async () => {
    const origin = await startServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(DEFAULT_MAX_RESPONSE_BYTES + 1),
      })
      res.end()
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      profile: 'configuredEndpoint',
      method: 'HEAD',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
  })
})

describe('pinned fetch response decoding', () => {
  it('returns a null body for HEAD even when metadata advertises gzip', async () => {
    const origin = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': '10000' })
      res.end()
    })
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', {
      profile: 'configuredEndpoint',
      maxResponseSize: 1024,
    })
    try {
      const response = await transport.fetch(origin, { method: 'HEAD' })

      expect(response.body).toBeNull()
      await expect(response.text()).resolves.toBe('')
      expect(response.headers.get('content-encoding')).toBe('gzip')
      expect(response.headers.get('content-length')).toBe('10000')
    } finally {
      await transport.dispatcher.destroy()
    }
  })

  it('enforces maxResponseSize on decoded content and cancels its upstream', async () => {
    const encoded = gzipSync(Buffer.alloc(64 * 1024, 0x41))
    const closed = vi.fn()
    expect(encoded.length).toBeLessThan(1024)
    const origin = await startServer((_req, res) => {
      res.once('close', closed)
      res.writeHead(200, { 'Content-Encoding': 'gzip' })
      res.write(encoded)
    })
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', {
      profile: 'configuredEndpoint',
      maxResponseSize: 1024,
    })
    try {
      const response = await transport.fetch(origin)

      await expect(response.text()).rejects.toMatchObject({ code: 'UND_ERR_RES_EXCEEDED_MAX_SIZE' })
      await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
    } finally {
      await transport.dispatcher.destroy()
    }
  })

  it('still permits decoded responses when maxResponseSize is explicitly unbounded', async () => {
    const payload = 'a'.repeat(64 * 1024)
    const origin = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' })
      res.end(gzipSync(payload))
    })
    const transport = createPinnedFetchWithDispatcher('127.0.0.1', {
      profile: 'configuredEndpoint',
      maxResponseSize: -1,
    })
    try {
      const response = await transport.fetch(origin)
      await expect(response.text()).resolves.toBe(payload)
    } finally {
      await transport.dispatcher.destroy()
    }
  })

  it.each(['bounded', 'guarded'] as const)(
    'keeps %s cancellation attached until decoding finishes',
    async (mode) => {
      const decoder = new Transform({
        transform(_chunk, _encoding, done) {
          done()
        },
        flush() {},
      })
      vi.spyOn(zlib, 'createGunzip').mockReturnValue(decoder as zlib.Gunzip)
      const dispatcher = new Agent()
      if (mode === 'bounded') {
        vi.spyOn(networkTransport, 'createOutboundTransport').mockReturnValueOnce({
          selectDispatcher: async () => dispatcher,
          close: () => dispatcher.close(),
          destroy: () => dispatcher.destroy(),
        })
      }
      const pinned =
        mode === 'guarded'
          ? createPinnedFetchWithDispatcher('127.0.0.1', { profile: 'configuredEndpoint' })
          : undefined
      const wireClosed = vi.fn()
      const send = networkTransport.requestWithOutboundDispatcher
      vi.spyOn(networkTransport, 'requestWithOutboundDispatcher').mockImplementationOnce(
        async (...args) => {
          const reply = await send(...args)
          reply.body.once('close', wireClosed)
          return reply
        }
      )
      const origin = await startServer((_req, res) => {
        res.writeHead(200, { 'Content-Encoding': 'gzip' })
        res.end(gzipSync('payload'))
      })
      const controller = new AbortController()
      const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
      try {
        const response = pinned
          ? await pinned.fetch(origin, { signal: controller.signal })
          : await secureFetchWithPinnedIP(origin, '127.0.0.1', {
              profile: 'configuredEndpoint',
              signal: controller.signal,
            })
        await vi.waitFor(() => expect(wireClosed).toHaveBeenCalledOnce())
        if (mode === 'bounded') {
          expect(removeListener).not.toHaveBeenCalledWith('abort', expect.any(Function))
        }
        const reading = response.text()
        const reason = new Error('decoding cancelled')
        controller.abort(reason)

        if (mode === 'guarded') await expect(reading).rejects.toBe(reason)
        else await expect(reading).rejects.toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' })
        expect(decoder.destroyed).toBe(true)
      } finally {
        decoder.destroy()
        await pinned?.dispatcher.destroy()
        await dispatcher.destroy()
      }
    }
  )
})
