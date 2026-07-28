/**
 * @vitest-environment node
 */
import { inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/core/execution-limits', () => ({ getMaxExecutionTimeout: () => 30_000 }))
vi.mock('@sim/utils/helpers', () => ({ sleep: () => Promise.resolve() }))

import { MAX_FAL_QUEUE_JSON_BYTES, runFalQueue } from '@/lib/media/falai'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

function jsonResponse(payload: unknown, ok = true) {
  const text = JSON.stringify(payload)
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: () => null },
    body: null,
    text: async () => text,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

describe('runFalQueue', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '8.8.8.8' })
  })

  it('polls the queue through the SSRF-guarded client, revalidating on every poll', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ request_id: 'req-1' }), { status: 200 })
    )
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse({ status: 'IN_QUEUE' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(jsonResponse({ video: { url: 'https://cdn.fal.media/a.mp4' } }))

    const result = await runFalQueue('fal-ai/test', { prompt: 'hi' }, 'fal-key')

    expect(result.requestId).toBe('req-1')
    // Two status polls + one result fetch, all through the guarded client.
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(3)
    // The URL is re-validated on every hop, not pinned once at submit time.
    expect(mockValidateUrlWithDNS).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a status_url that leaves the Fal.ai queue origin (no API-key exfiltration)', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          request_id: 'req-2',
          status_url: 'https://evil.example.net/steal',
          response_url: 'https://evil.example.net/steal',
        }),
        { status: 200 }
      )
    )
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(jsonResponse({ video: { url: 'https://cdn.fal.media/a.mp4' } }))

    await runFalQueue('fal-ai/test', { prompt: 'hi' }, 'fal-key')

    const urls = mockSecureFetchWithPinnedIP.mock.calls.map(([url]) => url)
    expect(urls).toEqual([
      'https://queue.fal.run/fal-ai/test/requests/req-2/status',
      'https://queue.fal.run/fal-ai/test/requests/req-2',
    ])
    for (const [, , options] of mockSecureFetchWithPinnedIP.mock.calls) {
      expect(options.headers.Authorization).toBe('Key fal-key')
    }
  })

  it('builds the fallback queue URL from the app id for a multi-segment endpoint', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ request_id: 'req-4', status_url: 'https://evil.example.net/steal' }),
        { status: 200 }
      )
    )
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(jsonResponse({ video: { url: 'https://cdn.fal.media/a.mp4' } }))

    // fal.ai routes queue polling under `{owner}/{alias}` only — the model sub-path 405s.
    await runFalQueue('fal-ai/kling-video/v3/pro/text-to-video', { prompt: 'hi' }, 'fal-key')

    expect(mockSecureFetchWithPinnedIP.mock.calls.map(([url]) => url)).toEqual([
      'https://queue.fal.run/fal-ai/kling-video/requests/req-4/status',
      'https://queue.fal.run/fal-ai/kling-video/requests/req-4',
    ])
  })

  it('strips the unroutable /response suffix Fal.ai echoes back (queue.fal.run 405s on it)', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          request_id: 'req-5',
          status_url: 'https://queue.fal.run/fal-ai/test/requests/req-5/status',
          response_url: 'https://queue.fal.run/fal-ai/test/requests/req-5/response',
        }),
        { status: 200 }
      )
    )
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(jsonResponse({ video: { url: 'https://cdn.fal.media/a.mp4' } }))

    await runFalQueue('fal-ai/test', { prompt: 'hi' }, 'fal-key')

    expect(mockSecureFetchWithPinnedIP.mock.calls.map(([url]) => url)).toEqual([
      'https://queue.fal.run/fal-ai/test/requests/req-5/status',
      'https://queue.fal.run/fal-ai/test/requests/req-5',
    ])
  })

  it('strips /response from a response_url echoed by the completed status body', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ request_id: 'req-6' }), { status: 200 })
    )
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'COMPLETED',
          response_url: 'https://queue.fal.run/fal-ai/other/requests/req-6/response',
        })
      )
      .mockResolvedValueOnce(jsonResponse({ video: { url: 'https://cdn.fal.media/a.mp4' } }))

    await runFalQueue('fal-ai/test', { prompt: 'hi' }, 'fal-key')

    expect(mockSecureFetchWithPinnedIP.mock.calls[1][0]).toBe(
      'https://queue.fal.run/fal-ai/other/requests/req-6'
    )
  })

  it('rejects a same-origin candidate whose path is not a routable queue path', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          request_id: 'req-7',
          // Same origin, but not `/{app}/requests/{id}[/status]` — never routable.
          status_url: 'https://queue.fal.run/fal-ai/test/requests/req-7',
          response_url: 'https://queue.fal.run/fal-ai/test/requests/req-7/status',
        }),
        { status: 200 }
      )
    )
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(jsonResponse({ video: { url: 'https://cdn.fal.media/a.mp4' } }))

    await runFalQueue('fal-ai/test', { prompt: 'hi' }, 'fal-key')

    expect(mockSecureFetchWithPinnedIP.mock.calls.map(([url]) => url)).toEqual([
      'https://queue.fal.run/fal-ai/test/requests/req-7/status',
      'https://queue.fal.run/fal-ai/test/requests/req-7',
    ])
  })

  it('bounds every queue read with the shared Fal queue JSON cap', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ request_id: 'req-8' }), { status: 200 })
    )
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(jsonResponse({ video: { url: 'https://cdn.fal.media/a.mp4' } }))

    await runFalQueue('fal-ai/test', { prompt: 'hi' }, 'fal-key')

    for (const [, , options] of mockSecureFetchWithPinnedIP.mock.calls) {
      expect(options.maxResponseBytes).toBe(MAX_FAL_QUEUE_JSON_BYTES)
    }
  })

  it('honors a status_url that stays on the Fal.ai queue origin', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          request_id: 'req-3',
          status_url: 'https://queue.fal.run/fal-ai/other/requests/req-3/status',
        }),
        { status: 200 }
      )
    )
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(jsonResponse({ video: { url: 'https://cdn.fal.media/a.mp4' } }))

    await runFalQueue('fal-ai/test', { prompt: 'hi' }, 'fal-key')

    expect(mockSecureFetchWithPinnedIP.mock.calls[0][0]).toBe(
      'https://queue.fal.run/fal-ai/other/requests/req-3/status'
    )
  })
})
