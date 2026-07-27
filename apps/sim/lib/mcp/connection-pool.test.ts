/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpClient } from '@/lib/mcp/client'
import { type AcquireParams, McpConnectionPool } from '@/lib/mcp/connection-pool'

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

/** Acquire + immediately release (models a completed borrow). */
async function borrow(
  pool: McpConnectionPool,
  params: AcquireParams,
  poison = false
): Promise<void> {
  const lease = await pool.acquire(params)
  await lease.release(poison)
}

function params(key: string, create: () => Promise<McpClient>): AcquireParams {
  return { key, serverId: key.split(':')[0], create }
}

/** Drain the microtask queue so an in-flight acquire fully settles before the next step. */
async function flushMicrotasks(turns = 50): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
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

    await borrow(pool, params('s1:w1:u1', create))
    await borrow(pool, params('s1:w1:u1', create))

    expect(create).toHaveBeenCalledTimes(1)
    expect(client.disconnect).not.toHaveBeenCalled()
  })

  it('keeps the connection after a single timeout release', async () => {
    const client = makeFakeClient()
    const create = vi.fn(async () => client)

    const lease = await pool.acquire(params('s1:w1:u1', create))
    await lease.release(false, true)
    await borrow(pool, params('s1:w1:u1', create))

    expect(create).toHaveBeenCalledTimes(1)
    expect(client.disconnect).not.toHaveBeenCalled()
  })

  it('retires the connection after consecutive timeouts (circuit breaker)', async () => {
    const client = makeFakeClient()
    const replacement = makeFakeClient()
    const create = vi.fn<() => Promise<McpClient>>()
    create.mockResolvedValueOnce(client)
    create.mockResolvedValue(replacement)

    const l1 = await pool.acquire(params('s1:w1:u1', create))
    await l1.release(false, true)
    const l2 = await pool.acquire(params('s1:w1:u1', create))
    await l2.release(false, true)

    expect(client.disconnect).toHaveBeenCalledTimes(1)
    const l3 = await pool.acquire(params('s1:w1:u1', create))
    expect(l3.client).toBe(replacement)
    await l3.release()
  })

  it('resets the timeout count on a healthy release', async () => {
    const client = makeFakeClient()
    const create = vi.fn(async () => client)

    const l1 = await pool.acquire(params('s1:w1:u1', create))
    await l1.release(false, true)
    await borrow(pool, params('s1:w1:u1', create)) // healthy — resets the count
    const l3 = await pool.acquire(params('s1:w1:u1', create))
    await l3.release(false, true) // first of a new streak, not the second strike

    expect(client.disconnect).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('dedups concurrent creates into a single connect (single-flight)', async () => {
    let resolveCreate: ((client: McpClient) => void) | undefined
    const created = new Promise<McpClient>((resolve) => {
      resolveCreate = resolve
    })
    const create = vi.fn(() => created)

    const p1 = pool.acquire(params('s1:w1:u1', create))
    const p2 = pool.acquire(params('s1:w1:u1', create))

    resolveCreate?.(makeFakeClient())
    const [l1, l2] = await Promise.all([p1, p2])

    expect(create).toHaveBeenCalledTimes(1)
    expect(l1.client).toBe(l2.client)
    await l1.release()
    await l2.release()
  })

  it('keys by (server, workspace, user) so different users do not share a connection', async () => {
    const a = makeFakeClient()
    const b = makeFakeClient()
    const createA = vi.fn(async () => a)
    const createB = vi.fn(async () => b)

    const la = await pool.acquire(params('s1:w1:userA', createA))
    const lb = await pool.acquire(params('s1:w1:userB', createB))

    expect(la.client).toBe(a)
    expect(lb.client).toBe(b)
    expect(createA).toHaveBeenCalledTimes(1)
    expect(createB).toHaveBeenCalledTimes(1)
  })

  it('rebuilds after the max connection age', async () => {
    const oldClient = makeFakeClient()
    const newClient = makeFakeClient()
    const create = vi
      .fn<() => Promise<McpClient>>()
      .mockResolvedValueOnce(oldClient)
      .mockResolvedValueOnce(newClient)

    await borrow(pool, params('s1:w1:u1', create))
    vi.setSystemTime(Date.now() + 11 * 60 * 1000)
    const lease = await pool.acquire(params('s1:w1:u1', create))

    expect(create).toHaveBeenCalledTimes(2)
    expect(oldClient.disconnect).toHaveBeenCalledTimes(1)
    expect(lease.client).toBe(newClient)
    await lease.release()
  })

  it('caches liveness for 60s, then pings before reuse', async () => {
    const client = makeFakeClient()
    const create = vi.fn(async () => client)

    await borrow(pool, params('s1:w1:u1', create))
    vi.setSystemTime(Date.now() + 30 * 1000)
    await borrow(pool, params('s1:w1:u1', create))
    expect(client.ping).not.toHaveBeenCalled()

    vi.setSystemTime(Date.now() + 61 * 1000)
    await borrow(pool, params('s1:w1:u1', create))
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

    await borrow(pool, params('s1:w1:u1', create))
    vi.setSystemTime(Date.now() + 61 * 1000)
    const lease = await pool.acquire(params('s1:w1:u1', create))

    expect(dead.disconnect).toHaveBeenCalledTimes(1)
    expect(lease.client).toBe(fresh)
    await lease.release()
  })

  it('drops a connection from the pool when its transport closes', async () => {
    const client = makeFakeClient()
    const fresh = makeFakeClient()
    const create = vi
      .fn<() => Promise<McpClient>>()
      .mockResolvedValueOnce(client)
      .mockResolvedValueOnce(fresh)

    await borrow(pool, params('s1:w1:u1', create))
    client.__fireClose()
    const lease = await pool.acquire(params('s1:w1:u1', create))

    expect(create).toHaveBeenCalledTimes(2)
    expect(lease.client).toBe(fresh)
    await lease.release()
  })

  it('does not disconnect a connection while a borrower still holds it', async () => {
    const client = makeFakeClient()
    const create = vi.fn(async () => client)

    const lease = await pool.acquire(params('s1:w1:u1', create))
    // Retire while borrowed (e.g. server config cleared): must defer the close.
    await pool.evictServer('s1', 'test')
    expect(client.disconnect).not.toHaveBeenCalled()

    // Closes only once the last borrower releases.
    await lease.release()
    expect(client.disconnect).toHaveBeenCalledTimes(1)
  })

  it('does not let one borrower failure disconnect a connection another borrower is using', async () => {
    const client = makeFakeClient()
    const create = vi.fn(async () => client)

    const a = await pool.acquire(params('s1:w1:u1', create))
    const b = await pool.acquire(params('s1:w1:u1', create))
    expect(create).toHaveBeenCalledTimes(1)

    // A fails and poisons the connection while B is still in flight.
    await a.release(true)
    expect(client.disconnect).not.toHaveBeenCalled()

    // B finishes → now the retired connection closes.
    await b.release()
    expect(client.disconnect).toHaveBeenCalledTimes(1)
  })

  it('does not idle-evict a connection with an active borrower', async () => {
    const client = makeFakeClient()
    const lease = await pool.acquire(params('s1:w1:u1', async () => client))

    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    expect(client.disconnect).not.toHaveBeenCalled()

    await lease.release()
  })

  it('idle-evicts a connection once no borrower holds it', async () => {
    const client = makeFakeClient()
    await borrow(
      pool,
      params('s1:w1:u1', async () => client)
    )

    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    expect(client.disconnect).toHaveBeenCalledTimes(1)
  })

  it('does not evict a replacement when a stale connection closes under the same key', async () => {
    const oldClient = makeFakeClient()
    const newClient = makeFakeClient()
    const create = vi
      .fn<() => Promise<McpClient>>()
      .mockResolvedValueOnce(oldClient)
      .mockResolvedValueOnce(newClient)

    // oldClient's transport closes → retired; the next acquire pools newClient.
    await borrow(pool, params('s1:w1:u1', create))
    oldClient.__fireClose()
    await borrow(pool, params('s1:w1:u1', create))

    // A late duplicate close from the old client must NOT drop the replacement.
    oldClient.__fireClose()
    await borrow(pool, params('s1:w1:u1', create))

    // Still 2 creates — the replacement survived the stale close.
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('uses an evicted-mid-create connection one-shot and does not pool it', async () => {
    let resolveCreate: ((client: McpClient) => void) | undefined
    const created = new Promise<McpClient>((resolve) => {
      resolveCreate = resolve
    })
    const staleClient = makeFakeClient()
    const freshClient = makeFakeClient()
    const create = vi
      .fn<() => Promise<McpClient>>()
      .mockImplementationOnce(() => created)
      .mockImplementation(async () => freshClient)

    const acquireP = pool.acquire(params('s1:w1:u1', create))
    // Server config changes while the connect is still in flight.
    await pool.evictServer('s1', 'config changed')
    resolveCreate?.(staleClient)
    const lease = await acquireP

    // The in-flight request still uses the connection it built (as connect-per-op
    // would), but it isn't pooled and is disconnected on release.
    expect(lease.client).toBe(staleClient)
    expect(staleClient.disconnect).not.toHaveBeenCalled()
    await lease.release()
    expect(staleClient.disconnect).toHaveBeenCalledTimes(1)

    // The next acquire builds fresh — the stale connection was never pooled.
    const next = await pool.acquire(params('s1:w1:u1', create))
    expect(next.client).toBe(freshClient)
    expect(create).toHaveBeenCalledTimes(2)
    await next.release()
  })

  it('reuses a concurrently-pooled replacement rather than orphaning it (recreate race)', async () => {
    // stale's ping is deferred per-call so we can fully resolve one acquire before
    // the other's ping settles — the exact interleaving that used to leak.
    const releasePing: Array<(alive: boolean) => void> = []
    const stale = makeFakeClient()
    ;(stale.ping as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          releasePing.push((alive) => (alive ? resolve({}) : reject(new Error('dead'))))
        })
    )
    const fresh = makeFakeClient()
    const create = vi
      .fn<() => Promise<McpClient>>()
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(fresh)

    await borrow(pool, params('s1:w1:u1', create))
    vi.setSystemTime(Date.now() + 61 * 1000)

    const pA = pool.acquire(params('s1:w1:u1', create))
    const pB = pool.acquire(params('s1:w1:u1', create))
    while (releasePing.length < 2) await Promise.resolve()

    // A's ping fails → A retires stale, rebuilds `fresh`, pools it, clears pending.
    releasePing[0](false)
    await flushMicrotasks()
    // B's ping fails → B must reuse the pooled `fresh`, not create a third client.
    releasePing[1](false)

    const [la, lb] = await Promise.all([pA, pB])
    expect(create).toHaveBeenCalledTimes(2)
    expect(la.client).toBe(fresh)
    expect(lb.client).toBe(fresh)
    await la.release()
    await lb.release()
  })

  it('bypasses the pool once disposed (connects without caching)', async () => {
    const client = makeFakeClient()
    const create = vi.fn(async () => client)

    pool.dispose()
    const lease = await pool.acquire(params('s1:w1:u1', create))
    expect(lease.client).toBe(client)
    await lease.release()

    await pool.acquire(params('s1:w1:u1', create)).then((l) => l.release())
    expect(create).toHaveBeenCalledTimes(2)
  })
})
