/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/utils/urls', () => ({ getSocketServerUrl: () => 'http://realtime' }))
vi.mock('@/lib/core/config/env', () => ({ env: { INTERNAL_API_SECRET: 'secret' } }))

import { applyEditToLiveFileDoc, invalidateLiveFileDoc } from '@/lib/realtime/notify'

describe('applyEditToLiveFileDoc', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the edit to the realtime apply-edit endpoint with the api key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ applied: true, status: 'applied' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await applyEditToLiveFileDoc('file-1', '# hello', { version: 42 })

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

  it('throws when the realtime call fails so the outbox can retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket pod down')))
    await expect(applyEditToLiveFileDoc('file-1', '# hello', { version: 42 })).rejects.toThrow(
      'socket pod down'
    )
  })

  it('surfaces retryable delivery failures to durable outbox callers', async () => {
    const cancel = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 503 }))
    )

    await expect(applyEditToLiveFileDoc('file-1', '# hello', { version: 42 })).rejects.toThrow(
      'status 503'
    )
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('returns the relay reconciliation status to durable outbox callers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ applied: false, status: 'no-live-room' }),
      })
    )

    await expect(applyEditToLiveFileDoc('file-1', '# hello', { version: 42 })).resolves.toEqual({
      applied: false,
      status: 'no-live-room',
    })
  })
})

describe('invalidateLiveFileDoc', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([200, 503])('cancels unread response bodies for status %i', async (status) => {
    const cancel = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status }))
    )

    const result = invalidateLiveFileDoc('file-1', 42)
    if (status === 200) {
      await expect(result).resolves.toBeUndefined()
    } else {
      await expect(result).rejects.toThrow('status 503')
    }
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('preserves the HTTP failure when response-body cancellation fails', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('body already errored'))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 503 }))
    )

    await expect(invalidateLiveFileDoc('file-1', 42)).rejects.toThrow('status 503')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('POSTs a durability-sensitive invalidation and surfaces delivery failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await invalidateLiveFileDoc('file-1', 42)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://realtime/api/file-doc/invalidate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': 'secret' }),
        body: JSON.stringify({ fileId: 'file-1', version: 42 }),
      })
    )

    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })
    await expect(invalidateLiveFileDoc('file-1', 42)).rejects.toThrow('status 503')
  })
})
