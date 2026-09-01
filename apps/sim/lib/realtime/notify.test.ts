/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/utils/urls', () => ({ getSocketServerUrl: () => 'http://realtime' }))
vi.mock('@/lib/core/config/env', () => ({ env: { INTERNAL_API_SECRET: 'secret' } }))

import { mergeEditIntoLiveFileDoc, notifyFolderResourceChanged } from './notify'

describe('notifyFolderResourceChanged', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('routes workflow folder changes to the workspace workflows endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await notifyFolderResourceChanged('workflow', 'workspace-1')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://realtime/api/workspace-workflows-changed',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspaceId: 'workspace-1' }),
      })
    )
  })
})

describe('mergeEditIntoLiveFileDoc', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the edit to the realtime apply-edit endpoint with the api key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await mergeEditIntoLiveFileDoc('file-1', '# hello', { version: 42 })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://realtime/api/file-doc/apply-edit',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': 'secret' }),
        // A durable write sends `version`; an unversioned (legacy) call would drop it via JSON.stringify.
        body: JSON.stringify({ fileId: 'file-1', markdown: '# hello', version: 42 }),
      })
    )
  })

  it('never throws when the realtime call fails (best-effort)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket pod down')))
    await expect(
      mergeEditIntoLiveFileDoc('file-1', '# hello', { version: 42 })
    ).resolves.toBeUndefined()
  })

  it('never throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(
      mergeEditIntoLiveFileDoc('file-1', '# hello', { version: 42 })
    ).resolves.toBeUndefined()
  })

  it('a later durable merge waits for an in-flight earlier one, then applies last', async () => {
    let resolveFirst: (value: { ok: boolean }) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const first = mergeEditIntoLiveFileDoc('file-durable', 'earlier', { version: 99 }) // in flight
    await Promise.resolve()
    const durable = mergeEditIntoLiveFileDoc('file-durable', 'final content', { version: 100 })
    await Promise.resolve()
    await Promise.resolve()

    // The later write waits for the in-flight earlier one → its fetch has not fired yet, so it cannot be
    // reordered before a straggler and cannot be clobbered by one.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFirst({ ok: true })
    await first
    await durable

    // Only after the earlier merge completed does the later (final) merge apply — always last.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].body).toBe(
      JSON.stringify({ fileId: 'file-durable', markdown: 'final content', version: 100 })
    )
  })

  it('serializes concurrent durable writes to a file strictly in order', async () => {
    const applied: number[] = []
    const resolvers: Array<() => void> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: { body: string }) => {
        applied.push(JSON.parse(init.body).version)
        return new Promise<{ ok: boolean }>((resolve) =>
          resolvers.push(() => resolve({ ok: true }))
        )
      })
    )
    const flush = async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve()
    }

    const s = mergeEditIntoLiveFileDoc('file-order', 's', { version: 0 }) // in flight
    await flush()
    // Two later durable writes arrive while the first merge is in flight — both must chain, not both
    // resume-and-fire concurrently.
    const a = mergeEditIntoLiveFileDoc('file-order', 'a', { version: 1 })
    const b = mergeEditIntoLiveFileDoc('file-order', 'b', { version: 2 })
    await flush()
    expect(applied).toEqual([0]) // A and B queued behind the in-flight first merge

    resolvers[0]() // finish first → A applies next (not B)
    await flush()
    expect(applied).toEqual([0, 1])

    resolvers[1]() // finish A → B applies after A
    await flush()
    expect(applied).toEqual([0, 1, 2])

    resolvers[2]()
    await Promise.all([s, a, b])
  })
})
