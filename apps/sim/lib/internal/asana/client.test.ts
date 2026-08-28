/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { AsanaClient } from '@/lib/internal/asana/client'
import { AsanaOperationError } from '@/lib/internal/asana/errors'

describe('AsanaClient', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends OAuth credentials and cancellation to the provider', async () => {
    fetchMock.mockResolvedValue(new Response('{"data":{"gid":"task1"}}'))
    const controller = new AbortController()

    await expect(
      new AsanaClient('access-token').json('/tasks/task1', { method: 'GET' }, controller.signal)
    ).resolves.toEqual({ data: { gid: 'task1' } })

    expect(fetchMock).toHaveBeenCalledWith('https://app.asana.com/api/1.0/tasks/task1', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer access-token',
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
  })

  it('preserves structured provider status, message, help, and raw details', async () => {
    const details = JSON.stringify({
      errors: [{ message: 'Rate limited', help: 'Retry after the reset time' }],
    })
    fetchMock.mockResolvedValue(
      new Response(details, { status: 429, statusText: 'Too Many Requests' })
    )

    await expect(new AsanaClient('access-token').json('/tasks')).rejects.toEqual(
      new AsanaOperationError('Rate limited (Retry after the reset time)', 429, {
        success: false,
        error: 'Rate limited (Retry after the reset time)',
        details,
      })
    )
  })

  it('uses the route-compatible fallback for unstructured provider errors', async () => {
    fetchMock.mockResolvedValue(
      new Response('upstream unavailable', { status: 502, statusText: 'Bad Gateway' })
    )

    await expect(new AsanaClient('access-token').json('/tasks')).rejects.toMatchObject({
      status: 502,
      body: {
        success: false,
        error: 'Asana API error: 502 Bad Gateway',
        details: 'upstream unavailable',
      },
    })
  })

  it('caps provider responses before materializing oversized bodies', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled = true
      },
    })
    fetchMock.mockResolvedValue(
      new Response(stream, {
        headers: { 'Content-Length': String(10 * 1024 * 1024 + 1) },
      })
    )

    await expect(new AsanaClient('access-token').json('/tasks')).rejects.toEqual(
      new PayloadSizeLimitError({
        label: 'Asana API response',
        maxBytes: 10 * 1024 * 1024,
        observedBytes: 10 * 1024 * 1024 + 1,
      })
    )
    expect(cancelled).toBe(true)
  })

  it('cancels successful empty responses for delete operations', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled = true
      },
    })
    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }))

    await expect(
      new AsanaClient('access-token').empty('/tasks/task1', { method: 'DELETE' })
    ).resolves.toBeUndefined()
    expect(cancelled).toBe(true)
  })

  it('does not start provider work after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      new AsanaClient('access-token').json('/tasks', {}, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
