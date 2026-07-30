/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/utils/urls', () => ({ getSocketServerUrl: () => 'http://realtime' }))
vi.mock('@/lib/core/config/env', () => ({ env: { INTERNAL_API_SECRET: 'secret' } }))

import { mergeEditIntoLiveFileDoc } from './notify'

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

  it('drops a streaming (versionless) merge while one is already in flight for the same file', async () => {
    let resolveFirst: (value: { ok: boolean }) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const first = mergeEditIntoLiveFileDoc('file-inflight', 'v1') // versionless → in flight (pending)
    await Promise.resolve()
    // A second versionless merge while the first is pending is dropped, not queued — so a stale
    // snapshot can never land after a newer one and regress the doc.
    await mergeEditIntoLiveFileDoc('file-inflight', 'v2')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFirst({ ok: true })
    await first
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
})
