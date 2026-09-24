/**
 * @vitest-environment node
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
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
  createPinnedConnectionPool,
  secureFetchWithPinnedIP,
} from '@/lib/core/security/input-validation.server'

const servers: http.Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    server.close()
  }
})

/** Starts a loopback server that counts the TCP connections it accepts. */
async function startServer(handler: http.RequestListener) {
  const server = http.createServer(handler)
  servers.push(server)
  let connections = 0
  server.on('connection', () => connections++)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    connections: () => connections,
  }
}

describe('secureFetchWithPinnedIP connection reuse', () => {
  it('reuses one pinned connection across requests that share a pool', async () => {
    const server = await startServer((_req, res) => res.end('ok'))
    const pool = createPinnedConnectionPool()
    try {
      for (let index = 0; index < 3; index++) {
        const response = await secureFetchWithPinnedIP(server.origin, '127.0.0.1', {
          profile: 'configuredEndpoint',
          connectionPool: pool,
        })
        await expect(response.text()).resolves.toBe('ok')
      }
      expect(server.connections()).toBe(1)
    } finally {
      pool.destroy()
    }
  })

  it('opens a fresh connection per request without a pool', async () => {
    const server = await startServer((_req, res) => res.end('ok'))
    for (let index = 0; index < 2; index++) {
      const response = await secureFetchWithPinnedIP(server.origin, '127.0.0.1', {
        profile: 'configuredEndpoint',
      })
      await response.text()
    }
    expect(server.connections()).toBe(2)
  })

  it('never shares an agent between different pinned addresses', () => {
    const pool = createPinnedConnectionPool()
    try {
      const first = pool.agent(true, 'api.example.com', 443, '203.0.113.1')
      expect(pool.agent(true, 'api.example.com', 443, '203.0.113.1')).toBe(first)
      expect(pool.agent(true, 'api.example.com', 443, '203.0.113.2')).not.toBe(first)
      expect(pool.agent(true, 'other.example.com', 443, '203.0.113.1')).not.toBe(first)
    } finally {
      pool.destroy()
    }
  })
})

describe('secureFetchWithPinnedIP compressed responses', () => {
  it('asks for compression only when requested and returns the decoded body', async () => {
    const encodings: (string | undefined)[] = []
    const server = await startServer((req, res) => {
      encodings.push(req.headers['accept-encoding'])
      if (req.headers['accept-encoding']?.includes('gzip')) {
        res.writeHead(200, { 'Content-Encoding': 'gzip' })
        res.end(gzipSync(Buffer.from('{"ok":true}')))
      } else {
        res.end('{"ok":true}')
      }
    })
    const compressed = await secureFetchWithPinnedIP(server.origin, '127.0.0.1', {
      profile: 'configuredEndpoint',
      acceptCompressed: true,
    })
    await expect(compressed.json()).resolves.toEqual({ ok: true })
    const plain = await secureFetchWithPinnedIP(server.origin, '127.0.0.1', {
      profile: 'configuredEndpoint',
    })
    await expect(plain.json()).resolves.toEqual({ ok: true })
    expect(encodings).toEqual(['gzip, deflate, br', undefined])
  })
})

describe('secureFetchWithPinnedIP address pinning', () => {
  it.each([
    ['a fresh agent', undefined],
    ['a pooled agent', createPinnedConnectionPool()],
  ])('pins the address on the request itself with %s', async (_label, pool) => {
    const server = await startServer((_req, res) => res.end('ok'))
    const request = vi.spyOn(http, 'request')
    try {
      const response = await secureFetchWithPinnedIP(
        server.origin.replace('127.0.0.1', 'localhost'),
        '127.0.0.1',
        {
          profile: 'configuredEndpoint',
          connectionPool: pool,
        }
      )
      await response.text()
      const options = request.mock.calls[0]?.[0] as http.RequestOptions
      const lookup = options.lookup as unknown as (
        hostname: string,
        options: object,
        callback: (error: Error | null, address: string, family: number) => void
      ) => void
      const resolved = await new Promise<string>((resolve) =>
        lookup('localhost', {}, (_error, address) => resolve(address))
      )
      expect(resolved).toBe('127.0.0.1')
    } finally {
      request.mockRestore()
      pool?.destroy()
    }
  })
})
