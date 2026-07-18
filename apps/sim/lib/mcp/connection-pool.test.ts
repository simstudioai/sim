/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpClient } from '@/lib/mcp/client'
import { McpConnectionPool } from '@/lib/mcp/connection-pool'

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

interface FakeClient extends McpClient {
  __fireClose(): void
  __setConnected(connected: boolean): void
}

function makeFakeClient(init: { connected?: boolean; pingRejects?: boolean } = {}): FakeClient {
  let connected = init.connected ?? true
  const closeCallbacks: Array<() => void> = []
  const client = {
    getStatus: vi.fn(() => ({ connected })),
    ping: vi.fn(async () => {
      if (init.pingRejects) throw new Error('ping failed')
      return {}
    }),
    disconnect: vi.fn(async () => {
      connected = false
    }),
    onClose: vi.fn((cb: () => void) => {
      closeCallbacks.push(cb)
    }),
    __fireClose: () => {
      for (const cb of closeCallbacks) cb()
    },
    __setConnected: (value: boolean) => {
      connected = value
    },
  }
  // double-cast-allowed: test double only implements the McpClient surface the pool touches
  return client as unknown as FakeClient
}

describe('McpConnectionPool', () => {
  let pool: McpConnectionPool

  beforeEach(() => {
    vi.useFakeTimers()
    pool = new McpConnectionPool()
  })

  afterEach(() => {
    pool.dispose()
    vi.useRealTimers()
  })

  it('reuses a warm connection across acquires (connects once)', async () => {
    const client = makeFakeClient()
    const create = vi.fn(async () => client)

    const first = await pool.acquire({ key: 's1', create })
    const second = await pool.acquire({ key: 's1', create })

    expect(create).toHaveBeenCalledTimes(1)
    expect(first).toBe(client)
    expect(second).toBe(client)
  })

  it('dedups concurrent creates into a single connect (single-flight)', async () => {
    let resolveCreate: ((client: McpClient) => void) | undefined
    const created = new Promise<McpClient>((resolve) => {
      resolveCreate = resolve
    })
    const create = vi.fn(() => created)

    const p1 = pool.acquire({ key: 's1', create })
    const p2 = pool.acquire({ key: 's1', create })

    const client = makeFakeClient()
    resolveCreate?.(client)
    const [c1, c2] = await Promise.all([p1, p2])

    expect(create).toHaveBeenCalledTimes(1)
    expect(c1).toBe(client)
    expect(c2).toBe(client)
  })

  it('rebuilds and disconnects the old connection when the config changes', async () => {
    const oldClient = makeFakeClient()
    const newClient = makeFakeClient()
    const create = vi
      .fn<() => Promise<McpClient>>()
      .mockResolvedValueOnce(oldClient)
      .mockResolvedValueOnce(newClient)

    await pool.acquire({ key: 's1', configUpdatedAt: '2026-01-01T00:00:00.000Z', create })
    const second = await pool.acquire({
      key: 's1',
      configUpdatedAt: '2026-01-02T00:00:00.000Z',
      create,
    })

    expect(create).toHaveBeenCalledTimes(2)
    expect(oldClient.disconnect).toHaveBeenCalledTimes(1)
    expect(second).toBe(newClient)
  })

  it('does not rebuild when the config timestamp is unchanged or older', async () => {
    const client = makeFakeClient()
    const create = vi.fn(async () => client)

    await pool.acquire({ key: 's1', configUpdatedAt: '2026-01-02T00:00:00.000Z', create })
    await pool.acquire({ key: 's1', configUpdatedAt: '2026-01-01T00:00:00.000Z', create })

    expect(create).toHaveBeenCalledTimes(1)
    expect(client.disconnect).not.toHaveBeenCalled()
  })

  it('rebuilds after the max connection age (SSRF pin re-resolves)', async () => {
    const oldClient = makeFakeClient()
    const newClient = makeFakeClient()
    const create = vi
      .fn<() => Promise<McpClient>>()
      .mockResolvedValueOnce(oldClient)
      .mockResolvedValueOnce(newClient)

    await pool.acquire({ key: 's1', create })
    // Jump the clock past the 10-minute max age without firing the idle sweep.
    vi.setSystemTime(Date.now() + 11 * 60 * 1000)
    const second = await pool.acquire({ key: 's1', create })

    expect(create).toHaveBeenCalledTimes(2)
    expect(oldClient.disconnect).toHaveBeenCalledTimes(1)
    expect(second).toBe(newClient)
  })

  it('caches liveness for 60s, then pings and rebuilds on ping failure', async () => {
    const client = makeFakeClient()
    const create = vi.fn(async () => client)

    await pool.acquire({ key: 's1', create })
    // Within the liveness TTL: no ping.
    vi.setSystemTime(Date.now() + 30 * 1000)
    await pool.acquire({ key: 's1', create })
    expect(client.ping).not.toHaveBeenCalled()

    // Past the TTL: pings once and reuses (ping resolves).
    vi.setSystemTime(Date.now() + 61 * 1000)
    await pool.acquire({ key: 's1', create })
    expect(client.ping).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('evicts and rebuilds when the liveness ping fails', async () => {
    const dead = makeFakeClient({ pingRejects: true })
    const fresh = makeFakeClient()
    const create = vi
      .fn<() => Promise<McpClient>>()
      .mockResolvedValueOnce(dead)
      .mockResolvedValueOnce(fresh)

    await pool.acquire({ key: 's1', create })
    vi.setSystemTime(Date.now() + 61 * 1000)
    const second = await pool.acquire({ key: 's1', create })

    expect(dead.disconnect).toHaveBeenCalledTimes(1)
    expect(second).toBe(fresh)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('rebuilds a connection that reports it is no longer connected', async () => {
    const client = makeFakeClient()
    const fresh = makeFakeClient()
    const create = vi
      .fn<() => Promise<McpClient>>()
      .mockResolvedValueOnce(client)
      .mockResolvedValueOnce(fresh)

    await pool.acquire({ key: 's1', create })
    client.__setConnected(false)
    const second = await pool.acquire({ key: 's1', create })

    expect(client.disconnect).toHaveBeenCalledTimes(1)
    expect(second).toBe(fresh)
  })

  it('drops a connection from the pool when its transport closes', async () => {
    const client = makeFakeClient()
    const fresh = makeFakeClient()
    const create = vi
      .fn<() => Promise<McpClient>>()
      .mockResolvedValueOnce(client)
      .mockResolvedValueOnce(fresh)

    await pool.acquire({ key: 's1', create })
    client.__fireClose()
    const second = await pool.acquire({ key: 's1', create })

    expect(create).toHaveBeenCalledTimes(2)
    expect(second).toBe(fresh)
  })

  it('evict disconnects the pooled connection', async () => {
    const client = makeFakeClient()
    const create = vi.fn(async () => client)

    await pool.acquire({ key: 's1', create })
    await pool.evict('s1', 'test')

    expect(client.disconnect).toHaveBeenCalledTimes(1)
    // A follow-up acquire rebuilds.
    await pool.acquire({ key: 's1', create: vi.fn(async () => makeFakeClient()) })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('evicts idle connections on the background sweep', async () => {
    const client = makeFakeClient()
    await pool.acquire({ key: 's1', create: async () => client })

    // Advance past the 5-minute idle timeout so the 60s sweep evicts it.
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)

    expect(client.disconnect).toHaveBeenCalledTimes(1)
  })

  it('bypasses the pool once disposed (connects without caching)', async () => {
    const client = makeFakeClient()
    const create = vi.fn(async () => client)

    pool.dispose()
    const acquired = await pool.acquire({ key: 's1', create })

    expect(acquired).toBe(client)
    // Not cached: a second acquire connects again.
    await pool.acquire({ key: 's1', create })
    expect(create).toHaveBeenCalledTimes(2)
  })
})
