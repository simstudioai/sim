import { jsonResponse } from '@sim/testing/helpers/http'
import {
  executionLimitsMock,
  executionLimitsMockFns,
} from '@sim/testing/mocks/execution-limits.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads', () => uploadsMock)
vi.mock('@/lib/core/execution-limits', () => executionLimitsMock)
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { generateVideo } from '@/lib/internal/video/client'
import { executeVideoOperation } from '@/lib/internal/video/operations'
import { observeServiceCosts } from '@/lib/mothership/billing/service-observer'

executionLimitsMockFns.mockGetMaxExecutionTimeout.mockReturnValue(5000)

describe('Video provider client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.1',
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      new Response(Buffer.from('video'))
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    { model: 'gen4.5', limit: 1000 },
    { model: 'klingO3_4k', limit: 2500 },
    { model: 'kling_4', limit: 26000 },
  ])(
    'accepts the published prompt limit for $model and rejects overflow before submission',
    async ({ model, limit }) => {
      const mockFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ id: 'job' }))
        .mockResolvedValueOnce(
          jsonResponse({ status: 'SUCCEEDED', output: ['data:video/mp4;base64,dmlkZW8='] })
        )
      vi.stubGlobal('fetch', mockFetch)
      storageServiceMockFns.mockUploadFile.mockResolvedValue({
        path: '/api/files/video.mp4',
        size: 5,
      })
      const input = { provider: 'runway' as const, model, apiKey: 'key', prompt: 'a'.repeat(limit) }
      const context = { requestId: 'prompt-boundary', userId: 'user', headers: new Headers() }
      const completion = expect(executeVideoOperation(input, context)).resolves.toMatchObject({
        model,
      })
      await Promise.all([completion, vi.advanceTimersByTimeAsync(5000)])
      expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body)).promptText).toBe(input.prompt)

      mockFetch.mockClear()
      await expect(
        executeVideoOperation({ ...input, prompt: `${input.prompt}a` }, context)
      ).rejects.toThrow(`Prompt must be between 3 and ${limit} characters`)
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it.each([
    {
      provider: 'luma' as const,
      responses: [
        jsonResponse({ id: 'luma-1' }),
        jsonResponse({ state: 'completed', assets: { video: 'https://cdn.example/luma.mp4' } }),
      ],
      submitUrl: 'https://api.lumalabs.ai/dream-machine/v1/generations/video',
    },
    {
      provider: 'minimax' as const,
      responses: [
        jsonResponse({ base_resp: { status_code: 0 }, task_id: 'minimax-1' }),
        jsonResponse({ base_resp: { status_code: 0 }, status: 'Success', file_id: 'file-1' }),
        jsonResponse({ file: { download_url: 'https://cdn.example/minimax.mp4' } }),
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
          video: { url: 'data:video/mp4;base64,dmlkZW8=', width: 1920, height: 1080, duration: 8 },
        }),
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
    const [result] = await Promise.all([resultPromise, vi.advanceTimersByTimeAsync(5000)])
    if (testCase.provider === 'luma')
      expect(result).toMatchObject({ width: 1920, height: 1080, duration: 5 })
    if (testCase.provider === 'minimax')
      expect(result).toMatchObject({ width: 1360, height: 768, duration: 6 })

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(testCase.submitUrl)
    expect((mockFetch.mock.calls[0]?.[1] as RequestInit).method).toBe('POST')
    expect(
      mockFetch.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST'
      )
    ).toHaveLength(1)
  })

  it.each([
    {
      provider: 'luma' as const,
      model: 'ray-2',
      submit: '/dream-machine/v1/generations/video',
      poll: '/dream-machine/v1/generations/job',
      payload: { model: 'ray-2', prompt: 'A cinematic sunrise' },
      created: { id: 'job' },
      completed: { state: 'completed', assets: { video: 'data:video/mp4;base64,dmlkZW8=' } },
    },
    {
      provider: 'runway' as const,
      model: 'gen4.5',
      submit: '/v1/text_to_video',
      poll: '/v1/tasks/job',
      payload: { model: 'gen4.5', promptText: 'A cinematic sunrise' },
      created: { id: 'job' },
      completed: { status: 'SUCCEEDED', output: ['data:video/mp4;base64,dmlkZW8='] },
    },
    {
      provider: 'luma' as const,
      model: 'ray-3.2',
      submit: '/v1/generations',
      poll: '/v1/generations/job',
      payload: { model: 'ray-3.2', type: 'video', prompt: 'A cinematic sunrise' },
      created: { id: 'job' },
      completed: {
        state: 'completed',
        output: [{ type: 'video', url: 'data:video/mp4;base64,dmlkZW8=' }],
      },
    },
    {
      provider: 'minimax' as const,
      model: 'MiniMax-H3-Max',
      submit: '/v2/video_generation',
      poll: '/v2/query/video_generation/job',
      payload: {
        model: 'MiniMax-H3-Max',
        content: [{ type: 'text', text: 'A cinematic sunrise' }],
      },
      created: { task_id: 'job' },
      completed: {
        task: {
          id: 'job',
          status: 'succeeded',
          content: { url: 'data:video/mp4;base64,dmlkZW8=' },
        },
      },
    },
    {
      provider: 'veo' as const,
      model: 'gemini-omni-1.1-flash',
      submit: '/v1beta/interactions',
      poll: '/v1beta/interactions/job',
      payload: { model: 'gemini-omni-1.1-flash', input: 'A cinematic sunrise' },
      created: { id: 'job', status: 'in_progress' },
      completed: {
        status: 'completed',
        steps: [
          {
            type: 'model_output',
            content: [{ type: 'video', mime_type: 'video/mp4', data: 'dmlkZW8=' }],
          },
        ],
      },
    },
  ])('executes $model through its native submit, poll and result protocol', async (testCase) => {
    let submissions = 0
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      const path = new URL(url).pathname
      if (path === testCase.submit && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body))
        expect(payload).toMatchObject(testCase.payload)
        submissions++
        return jsonResponse(testCase.created)
      }
      if (path === testCase.poll) return jsonResponse(testCase.completed)
      return new Response('Unsupported provider endpoint', { status: 400 })
    })
    const pending = generateVideo(
      {
        provider: testCase.provider,
        model: testCase.model,
        apiKey: 'key',
        prompt: 'A cinematic sunrise',
      },
      { requestId: 'native-model' }
    )
    const completion = expect(pending).resolves.toMatchObject({
      buffer: Buffer.from('video'),
      jobId: 'job',
    })
    await Promise.all([completion, vi.advanceTimersByTimeAsync(5000)])
    expect(submissions).toBe(1)
  })

  it('reports a failed MiniMax job immediately instead of polling until timeout', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task_id: 'job' }))
      .mockResolvedValue(jsonResponse({ status: 'Failed', failure_reason: 'Generation rejected' }))
    vi.stubGlobal('fetch', fetchMock)
    const result = generateVideo(
      { provider: 'minimax', apiKey: 'key', prompt: 'A cinematic sunrise' },
      { requestId: 'failed-minimax' }
    )
    const rejected = expect(result).rejects.toThrow('Generation rejected')
    await Promise.all([rejected, vi.advanceTimersByTimeAsync(10_000)])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps a saved MiniMax Pro preference compatible with a 720P-only model', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ task_id: 'job' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'Success', file_id: 'file' }))
      .mockResolvedValueOnce(
        jsonResponse({ file: { download_url: 'https://cdn.example/video.mp4' } })
      )
    vi.stubGlobal('fetch', fetchMock)
    const result = generateVideo(
      {
        provider: 'minimax',
        model: 'T2V-01',
        endpoint: 'pro',
        apiKey: 'key',
        prompt: 'A cinematic sunrise',
      },
      { requestId: 'legacy-pro' }
    )
    const completion = expect(result).resolves.toMatchObject({ buffer: Buffer.from('video') })
    await Promise.all([completion, vi.advanceTimersByTimeAsync(5000)])
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'T2V-01',
      resolution: '720P',
    })
  })

  it('rejects malformed camera controls before submitting a paid Luma job', async () => {
    const fetchMock = vi.fn(() => {
      throw new Error('Unexpected paid request')
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      generateVideo(
        {
          provider: 'luma',
          model: 'ray-2',
          apiKey: 'key',
          prompt: 'A cinematic sunrise',
          cameraControl: { pan: 1 },
        },
        { requestId: 'invalid-camera' }
      )
    ).rejects.toThrow('Camera controls must be an array of concept keys')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retrieves a nested endpoint result when fal omits the queue URLs', async () => {
    const app = 'fal-ai/kandinsky5'
    const model = `${app}/text-to-video`
    const request = `/${app}/requests/fal-1`
    vi.stubGlobal('fetch', async (url: string | URL) => {
      switch (new URL(url).pathname) {
        case `/${model}`:
          return jsonResponse({ request_id: 'fal-1' })
        case `${request}/status`:
          return jsonResponse({ status: 'COMPLETED' })
        case request:
          return jsonResponse({ video: { url: 'data:video/mp4;base64,dmlkZW8=' } })
        default:
          return new Response(null, { status: 405 })
      }
    })
    const result = generateVideo(
      { provider: 'falai', apiKey: 'key', model, prompt: 'A cinematic sunrise' },
      { requestId: 'request-1' }
    )
    const completion = expect(result).resolves.toMatchObject({ buffer: Buffer.from('video') })
    await vi.advanceTimersByTimeAsync(5000)
    await completion
  })

  it('keeps the fal API key off a foreign polling origin', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ request_id: 'fal-1', status_url: 'https://untrusted.example/job' })
      )
      .mockResolvedValue(jsonResponse({ status: 'FAILED' }))
    vi.stubGlobal('fetch', mockFetch)

    const result = generateVideo(
      { provider: 'falai', apiKey: 'private-key', model: 'veo-3.1', prompt: 'A cinematic sunrise' },
      { requestId: 'request-1' }
    )
    const rejection = expect(result).rejects.toThrow()
    await Promise.all([rejection, vi.advanceTimersByTimeAsync(5000)])
    expect(mockFetch.mock.calls.map(([url]) => new URL(url).origin)).not.toContain(
      'https://untrusted.example'
    )
  })

  it('preserves the completed hosted receipt for reconciliation when Stop interrupts delivery', async () => {
    const controller = new AbortController()
    const requestId = 'completed-video'
    const endpoint = 'fal-ai/veo3.1'
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      init?.signal?.throwIfAborted()
      const path = new URL(url).pathname
      if (path === `/${endpoint}`) return jsonResponse({ request_id: requestId })
      if (path.endsWith('/status')) {
        controller.abort(new Error('Stopped'))
        return jsonResponse({ status: 'COMPLETED' })
      }
      if (path.endsWith('/billing-events')) {
        return jsonResponse({
          billing_events: [
            { request_id: requestId, endpoint_id: endpoint, cost_estimate_nano_usd: 400000000 },
          ],
        })
      }
      throw new Error('Unexpected provider request')
    })
    const pending: string[] = []
    const result = observeServiceCosts(
      async () => {
        throw new Error('Unexpected successful charge')
      },
      () =>
        executeVideoOperation(
          {
            provider: 'falai',
            model: 'veo-3.1',
            prompt: 'A sunrise',
            apiKey: 'key',
            useHostedCostTracking: true,
          },
          {
            requestId: 'trace-id',
            userId: 'user',
            headers: new Headers(),
            signal: controller.signal,
          }
        ),
      async (receipt) => {
        pending.push(receipt)
      }
    )
    const rejection = expect(result).rejects.toThrow('Stopped')
    await Promise.all([rejection, vi.advanceTimersByTimeAsync(5000)])
    expect(pending).toHaveLength(1)
    expect(pending[0]).toContain(requestId)
    expect(pending[0]).toContain('0.4')
  })

  it('cancels during the provider wait without polling or resubmitting', async () => {
    const controller = new AbortController()
    const mockFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ id: 'task-1' }))
    vi.stubGlobal('fetch', mockFetch)

    const resultPromise = generateVideo(
      {
        provider: 'runway',
        model: 'gen4.5',
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

  it('rejects a generated video whose declared size exceeds the 250 MiB cap', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1' }))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'SUCCEEDED', output: ['https://cdn.example/video.mp4'] })
      )
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      new Response(Buffer.from('video'), {
        headers: { 'Content-Length': String(250 * 1024 * 1024 + 1) },
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    const resultPromise = generateVideo(
      { provider: 'runway', model: 'gen4.5', apiKey: 'key', prompt: 'A cinematic sunrise' },
      { requestId: 'request-1' }
    )
    const rejection = expect(resultPromise).rejects.toMatchObject({
      name: 'PayloadSizeLimitError',
    })
    await Promise.all([rejection, vi.advanceTimersByTimeAsync(5000)])
  })

  it('times out after the execution deadline without resubmitting', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'RUNNING' }))
    vi.stubGlobal('fetch', mockFetch)

    const resultPromise = generateVideo(
      { provider: 'runway', model: 'gen4.5', apiKey: 'key', prompt: 'A cinematic sunrise' },
      { requestId: 'request-1' }
    )
    const rejection = expect(resultPromise).rejects.toThrow(/generation timed out/)
    await Promise.all([rejection, vi.advanceTimersByTimeAsync(5000)])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
