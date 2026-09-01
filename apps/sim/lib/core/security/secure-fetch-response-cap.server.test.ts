/**
 * @vitest-environment node
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
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

describe('secureFetchWithPinnedIP response cap', () => {
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

  it('reads a body that fits under the default cap', async () => {
    const origin = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      profile: 'configuredEndpoint',
    })

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

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      profile: 'configuredEndpoint',
      method: 'HEAD',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
  })

  it('does not trip on a 304 advertising a size above the cap', async () => {
    const origin = await startServer((_req, res) => {
      res.writeHead(304, { 'Content-Length': String(DEFAULT_MAX_RESPONSE_BYTES + 1) })
      res.end()
    })

    const response = await secureFetchWithPinnedIP(origin, '127.0.0.1', {
      profile: 'configuredEndpoint',
    })

    expect(response.status).toBe(304)
  })
})
