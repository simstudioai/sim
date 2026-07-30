/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/utils/urls', () => ({ getSocketServerUrl: () => 'http://realtime' }))
vi.mock('@/lib/core/config/env', () => ({ env: { INTERNAL_API_SECRET: 'secret' } }))

import { isLiveDocMergeInFlight, mergeEditIntoLiveFileDoc } from './notify'

describe('mergeEditIntoLiveFileDoc', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the edit to the realtime apply-edit endpoint with the api key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await mergeEditIntoLiveFileDoc('file-1', '# hello', 42)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://realtime/api/file-doc/apply-edit',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': 'secret' }),
        body: JSON.stringify({ fileId: 'file-1', markdown: '# hello', version: 42 }),
      })
    )
  })

  it('never throws when the realtime call fails (best-effort)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket pod down')))
    await expect(mergeEditIntoLiveFileDoc('file-1', '# hello', 42)).resolves.toBeUndefined()
  })

  it('never throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(mergeEditIntoLiveFileDoc('file-1', '# hello', 42)).resolves.toBeUndefined()
  })

  it('reports isLiveDocMergeInFlight while a merge runs and clears when it settles', async () => {
    let resolveFetch: (value: { ok: boolean }) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((resolve) => (resolveFetch = resolve)))
    )

    expect(isLiveDocMergeInFlight('file-flight')).toBe(false)
    const run = mergeEditIntoLiveFileDoc('file-flight', 'v1')
    await Promise.resolve()
    // The streaming caller checks this to skip a redundant merge (and not advance its throttle) while
    // one is in flight, so a slow relay can't backlog stale snapshots.
    expect(isLiveDocMergeInFlight('file-flight')).toBe(true)

    resolveFetch({ ok: true })
    await run
    expect(isLiveDocMergeInFlight('file-flight')).toBe(false)
  })

  it('a durable (versioned) merge waits for an in-flight streaming merge, then applies last', async () => {
    let resolveStream: (value: { ok: boolean }) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveStream = resolve)))
      .mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const stream = mergeEditIntoLiveFileDoc('file-durable', 'partial') // versionless, in flight
    await Promise.resolve()
    const durable = mergeEditIntoLiveFileDoc('file-durable', 'final content', 100) // versioned
    await Promise.resolve()
    await Promise.resolve()

    // The durable write waits for the in-flight streaming merge → its fetch has not fired yet, so it
    // cannot be reordered before a straggler and cannot be clobbered by one.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveStream({ ok: true })
    await stream
    await durable

    // Only after the streaming merge completed does the durable (final) merge apply — always last.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].body).toBe(
      JSON.stringify({ fileId: 'file-durable', markdown: 'final content', version: 100 })
    )
  })

  it('serializes concurrent durable writes behind a streaming merge, strictly in order', async () => {
    const applied: Array<number | 'stream'> = []
    const resolvers: Array<() => void> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: { body: string }) => {
        applied.push(JSON.parse(init.body).version ?? 'stream')
        return new Promise<{ ok: boolean }>((resolve) =>
          resolvers.push(() => resolve({ ok: true }))
        )
      })
    )
    const flush = async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve()
    }

    const s = mergeEditIntoLiveFileDoc('file-order', 's') // streaming, in flight
    await flush()
    // Two durable writes arrive while the streaming merge is in flight — both must chain, not both
    // resume-and-fire concurrently.
    const a = mergeEditIntoLiveFileDoc('file-order', 'a', 1)
    const b = mergeEditIntoLiveFileDoc('file-order', 'b', 2)
    await flush()
    expect(applied).toEqual(['stream']) // A and B queued behind streaming

    resolvers[0]() // finish streaming → A applies next (not B)
    await flush()
    expect(applied).toEqual(['stream', 1])

    resolvers[1]() // finish A → B applies after A
    await flush()
    expect(applied).toEqual(['stream', 1, 2])

    resolvers[2]()
    await Promise.all([s, a, b])
  })
})
