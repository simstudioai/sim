/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/execution-limits', () => ({ getMaxExecutionTimeout: () => 5000 }))

import { generateVideo } from '@/lib/internal/video/client'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Video provider client', () => {
  beforeEach(() => vi.useFakeTimers())

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('submits a Runway job once and only polls the returned task', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1' }))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'SUCCEEDED', output: ['https://cdn.example/video.mp4'] })
      )
      .mockResolvedValueOnce(new Response(Buffer.from('video')))
    vi.stubGlobal('fetch', mockFetch)

    const resultPromise = generateVideo(
      {
        provider: 'runway',
        apiKey: 'key',
        prompt: 'A cinematic sunrise',
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
      },
      { requestId: 'request-1' }
    )
    await vi.advanceTimersByTimeAsync(5000)
    const result = await resultPromise

    expect(result).toMatchObject({
      buffer: Buffer.from('video'),
      width: 1280,
      height: 720,
      jobId: 'task-1',
      duration: 5,
    })
    const requests = mockFetch.mock.calls.map(([url, init]) => ({
      method: (init as RequestInit | undefined)?.method,
      url: String(url),
    }))
    expect(requests).toEqual([
      {
        method: 'POST',
        url: 'https://api.dev.runwayml.com/v1/image_to_video',
      },
      {
        method: undefined,
        url: 'https://api.dev.runwayml.com/v1/tasks/task-1',
      },
      { method: undefined, url: 'https://cdn.example/video.mp4' },
    ])
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1)
  })

  it.each([
    {
      provider: 'veo' as const,
      responses: [
        jsonResponse({ name: 'operations/veo-1' }),
        jsonResponse({
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [{ video: { uri: 'https://cdn.example/veo.mp4' } }],
            },
          },
        }),
        new Response(Buffer.from('video')),
      ],
      submitUrl:
        'https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-001:predictLongRunning',
    },
    {
      provider: 'luma' as const,
      responses: [
        jsonResponse({ id: 'luma-1' }),
        jsonResponse({ state: 'completed', assets: { video: 'https://cdn.example/luma.mp4' } }),
        new Response(Buffer.from('video')),
      ],
      submitUrl: 'https://api.lumalabs.ai/dream-machine/v1/generations',
    },
    {
      provider: 'minimax' as const,
      responses: [
        jsonResponse({ base_resp: { status_code: 0 }, task_id: 'minimax-1' }),
        jsonResponse({ base_resp: { status_code: 0 }, status: 'Success', file_id: 'file-1' }),
        jsonResponse({ file: { download_url: 'https://cdn.example/minimax.mp4' } }),
        new Response(Buffer.from('video')),
      ],
      submitUrl: 'https://api.minimax.io/v1/video_generation',
    },
    {
      provider: 'falai' as const,
      responses: [
        jsonResponse({
          request_id: 'fal-1',
          status_url: 'https://queue.fal.run/status/fal-1',
          response_url: 'https://queue.fal.run/response/fal-1',
        }),
        jsonResponse({ status: 'COMPLETED' }),
        jsonResponse({
          video: { url: 'https://cdn.example/fal.mp4', width: 1920, height: 1080, duration: 8 },
        }),
        new Response(Buffer.from('video')),
      ],
      submitUrl: 'https://queue.fal.run/fal-ai/veo3.1',
    },
  ])('submits $provider once and polls only its returned provider job', async (testCase) => {
    const mockFetch = vi.fn()
    for (const response of testCase.responses) mockFetch.mockResolvedValueOnce(response)
    vi.stubGlobal('fetch', mockFetch)

    const resultPromise = generateVideo(
      {
        provider: testCase.provider,
        apiKey: 'key',
        model: testCase.provider === 'falai' ? 'veo-3.1' : undefined,
        prompt: 'A cinematic sunrise',
      },
      { requestId: 'request-1' }
    )
    await vi.advanceTimersByTimeAsync(5000)
    await resultPromise

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(testCase.submitUrl)
    expect((mockFetch.mock.calls[0]?.[1] as RequestInit).method).toBe('POST')
    expect(
      mockFetch.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST'
      )
    ).toHaveLength(1)
  })

  it('cancels during the provider wait without polling or resubmitting', async () => {
    const controller = new AbortController()
    const mockFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ id: 'task-1' }))
    vi.stubGlobal('fetch', mockFetch)

    const resultPromise = generateVideo(
      {
        provider: 'runway',
        apiKey: 'key',
        prompt: 'A cinematic sunrise',
      },
      { requestId: 'request-1', signal: controller.signal }
    )
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('forwards cancellation to submission, polling, and download requests', async () => {
    const controller = new AbortController()
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1' }))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'SUCCEEDED', output: ['https://cdn.example/video.mp4'] })
      )
      .mockResolvedValueOnce(new Response(Buffer.from('video')))
    vi.stubGlobal('fetch', mockFetch)

    const resultPromise = generateVideo(
      {
        provider: 'runway',
        apiKey: 'key',
        prompt: 'A cinematic sunrise',
      },
      { requestId: 'request-1', signal: controller.signal }
    )
    await vi.advanceTimersByTimeAsync(5000)
    await resultPromise

    for (const [, init] of mockFetch.mock.calls) {
      expect((init as RequestInit | undefined)?.signal).toBe(controller.signal)
    }
  })

  it('rejects a generated video whose declared size exceeds the 250 MiB cap', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1' }))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'SUCCEEDED', output: ['https://cdn.example/video.mp4'] })
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from('video'), {
          headers: { 'Content-Length': String(250 * 1024 * 1024 + 1) },
        })
      )
    vi.stubGlobal('fetch', mockFetch)

    const resultPromise = generateVideo(
      { provider: 'runway', apiKey: 'key', prompt: 'A cinematic sunrise' },
      { requestId: 'request-1' }
    )
    const rejection = expect(resultPromise).rejects.toMatchObject({
      name: 'PayloadSizeLimitError',
    })
    await vi.advanceTimersByTimeAsync(5000)
    await rejection
  })

  it('times out after the execution deadline without resubmitting', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'RUNNING' }))
    vi.stubGlobal('fetch', mockFetch)

    const resultPromise = generateVideo(
      { provider: 'runway', apiKey: 'key', prompt: 'A cinematic sunrise' },
      { requestId: 'request-1' }
    )
    const rejection = expect(resultPromise).rejects.toThrow('Runway generation timed out')
    await vi.advanceTimersByTimeAsync(5000)
    await rejection
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
