/**
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

import {
  type SecureFetchOptions,
  secureFetchWithPinnedIP,
} from '@/lib/core/security/input-validation.server'

interface ReceivedRequest {
  method: string
  headers: http.IncomingHttpHeaders
  body: Buffer
}

const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections()
          server.close((error) => (error ? reject(error) : resolve()))
        })
    )
  )
})

async function startServer(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** Exercises the actual pinned Node transport against a server that requires a body length. */
async function sendToLengthRequiredEndpoint(
  options: Omit<SecureFetchOptions, 'profile'>
): Promise<ReceivedRequest> {
  const received: ReceivedRequest[] = []
  const origin = await startServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      received.push({ method: req.method ?? '', headers: req.headers, body: Buffer.concat(chunks) })
      res.writeHead(req.headers['content-length'] === undefined ? 411 : 200)
      res.end('received')
    })
  })

  const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
    ...options,
    profile: 'configuredEndpoint',
  })
  expect(await response.text()).toBe('received')
  expect(response.status).toBe(200)
  expect(received).toHaveLength(1)
  expect(received[0].headers['transfer-encoding']).toBeUndefined()
  return received[0]
}

describe('secureFetchWithPinnedIP request framing', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'sends a UTF-8 %s body with its byte length',
    async (method) => {
      const body = JSON.stringify({ query: 'select 1', label: 'synthetic café 🦀' })
      const received = await sendToLengthRequiredEndpoint({
        method,
        body,
        headers: { 'Content-Type': 'application/json' },
      })

      expect(received.method).toBe(method)
      expect(received.body.toString('utf8')).toBe(body)
      expect(received.headers['content-length']).toBe(String(Buffer.byteLength(body)))
    }
  )

  it.each([
    { label: 'buffer', body: Buffer.from([0x00, 0xff, 0x80, 0x42]) },
    {
      label: 'byte view',
      body: new Uint8Array([0x11, 0x00, 0xff, 0x80, 0x42, 0x22]).subarray(1, 5),
    },
  ])('frames a $label without decoding or including bytes outside its view', async ({ body }) => {
    const received = await sendToLengthRequiredEndpoint({ method: 'POST', body })

    expect(received.body).toEqual(Buffer.from([0x00, 0xff, 0x80, 0x42]))
    expect(received.headers['content-length']).toBe('4')
  })

  it.each([
    { label: 'omitted', body: undefined },
    { label: 'empty string', body: '' },
    { label: 'empty buffer', body: Buffer.alloc(0) },
    { label: 'empty byte view', body: new Uint8Array(0) },
  ])('sends Content-Length: 0 for an $label POST body', async ({ body }) => {
    const received = await sendToLengthRequiredEndpoint({ method: 'POST', body })

    expect(received.body.length).toBe(0)
    expect(received.headers['content-length']).toBe('0')
  })

  it('preserves a caller-supplied Content-Length and does not mutate request headers', async () => {
    const headers = { 'cOnTeNt-LeNgTh': '2', 'Content-Type': 'application/octet-stream' }
    const received = await sendToLengthRequiredEndpoint({ method: 'POST', body: 'é', headers })

    expect(received.headers['content-length']).toBe('2')
    expect(received.body.toString('utf8')).toBe('é')
    expect(headers).toEqual({ 'cOnTeNt-LeNgTh': '2', 'Content-Type': 'application/octet-stream' })
  })

  it('preserves an explicitly requested chunked transfer without adding Content-Length', async () => {
    const received: ReceivedRequest[] = []
    const origin = await startServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        received.push({
          method: req.method ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks),
        })
        res.end('received')
      })
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      method: 'POST',
      body: 'é',
      headers: { 'Transfer-Encoding': 'chunked' },
      profile: 'configuredEndpoint',
    })

    expect(await response.text()).toBe('received')
    expect(received).toHaveLength(1)
    expect(received[0].body.toString('utf8')).toBe('é')
    expect(received[0].headers['transfer-encoding']).toBe('chunked')
    expect(received[0].headers['content-length']).toBeUndefined()
  })

  it('retains the original Host header while connecting only to the pinned address', async () => {
    let receivedHost: string | undefined
    const origin = await startServer((req, res) => {
      receivedHost = req.headers.host
      req.resume()
      req.on('end', () => res.end('received'))
    })
    const url = new URL(origin)
    url.hostname = 'pinned-request.invalid'

    const response = await secureFetchWithPinnedIP(url.href, '127.0.0.1', {
      method: 'POST',
      body: 'payload',
      profile: 'configuredEndpoint',
    })

    expect(await response.text()).toBe('received')
    expect(receivedHost).toBe(url.host)
  })

  it('cancels a framed request while waiting for response headers', async () => {
    const controller = new AbortController()
    const origin = await startServer((req) => {
      req.resume()
      req.on('end', () => controller.abort(new Error('synthetic cancellation')))
    })

    await expect(
      secureFetchWithPinnedIP(origin, '127.0.0.1', {
        method: 'POST',
        body: 'payload',
        signal: controller.signal,
        profile: 'configuredEndpoint',
      })
    ).rejects.toThrow('synthetic cancellation')
  })
})
