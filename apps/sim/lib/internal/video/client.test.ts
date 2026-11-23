import { jsonResponse } from '@sim/testing/helpers/http'
import {
  executionLimitsMock,
  executionLimitsMockFns,
} from '@sim/testing/mocks/execution-limits.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
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
vi.mock('@/lib/uploads/utils/file.server', () => fileUtilsServerMock)

import { generateVideo, getVideoInputValidationError } from '@/lib/internal/video/client'
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
    inputValidationMockFns.mockSecureFetchWithPinnedIP
      .mockReset()
      .mockResolvedValue(new Response(Buffer.from('video')))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    { provider: 'runway' as const, model: 'gen4.5', limit: 1000 },
    { provider: 'runway' as const, model: 'klingO3_4k', limit: 2500 },
    { provider: 'runway' as const, model: 'kling_4', limit: 26000 },
    { provider: 'luma' as const, model: 'ray-3.2', limit: 6000 },
    { provider: 'minimax' as const, model: 'MiniMax-H3', limit: 7000 },
  ])(
    'accepts the published prompt limit for $model and rejects overflow before submission',
    async ({ provider, model, limit }) => {
      const mockFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ id: 'job' }))
        .mockResolvedValueOnce(
          jsonResponse(
            provider === 'luma'
              ? {
                  state: 'completed',
                  output: [{ type: 'video', url: 'data:video/mp4;base64,dmlkZW8=' }],
                }
              : provider === 'minimax'
                ? {
                    task: {
                      status: 'succeeded',
                      content: { url: 'data:video/mp4;base64,dmlkZW8=' },
                    },
                  }
                : { status: 'SUCCEEDED', output: ['data:video/mp4;base64,dmlkZW8='] }
          )
        )
      vi.stubGlobal('fetch', mockFetch)
      storageServiceMockFns.mockUploadFile.mockResolvedValue({
        path: '/api/files/video.mp4',
        size: 5,
      })
      const input = { provider, model, apiKey: 'key', prompt: 'a'.repeat(limit) }
      const context = { requestId: 'prompt-boundary', userId: 'user', headers: new Headers() }
      const completion = expect(executeVideoOperation(input, context)).resolves.toMatchObject({
        model,
      })
      await Promise.all([completion, vi.advanceTimersByTimeAsync(5000)])
      expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))).toMatchObject(
        provider === 'runway'
          ? { promptText: input.prompt }
          : provider === 'luma'
            ? { prompt: input.prompt }
            : { content: [{ type: 'text', text: input.prompt }] }
      )

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

  describe('Gemini URI delivery', () => {
    const input = { provider: 'veo' as const, apiKey: 'key', prompt: 'A cinematic sunrise' }
    const videoUri =
      'https://generativelanguage.googleapis.com/v1beta/files/video-file:download?alt=media'
    const completed = (uri = videoUri) => ({
      id: 'interaction-1',
      status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'video', uri }] }],
    })

    it('downloads a normal-sized video after Files becomes ACTIVE without reading inline polling data', async () => {
      const video = Buffer.alloc(2 * 1024 * 1024)
      let filePolls = 0
      let submissions = 0
      vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
        const path = new URL(url).pathname
        if (path === '/v1beta/interactions' && init?.method === 'POST') {
          submissions++
          const body = JSON.parse(String(init.body))
          return jsonResponse(
            body.background ? { id: 'interaction-1', status: 'in_progress' } : completed()
          )
        }
        if (path === '/v1beta/interactions/interaction-1')
          return jsonResponse({
            ...completed(),
            steps: [
              {
                type: 'model_output',
                content: [{ type: 'video', data: video.toString('base64') }],
              },
            ],
          })
        if (path === '/v1beta/files/video-file') {
          filePolls++
          expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('key')
          return jsonResponse({ state: filePolls === 1 ? 'PROCESSING' : 'ACTIVE' })
        }
        return new Response(null, { status: 404 })
      })
      inputValidationMockFns.mockSecureFetchWithPinnedIP.mockImplementationOnce(
        async (_url, _ip, options) => {
          expect(new Headers(options.headers).get('x-goog-api-key')).toBe('key')
          return filePolls >= 2
            ? new Response(video)
            : new Response('File is not ACTIVE', { status: 409 })
        }
      )
      const result = generateVideo(input, { requestId: 'google-uri' })
      const completion = result.then((output) => {
        expect(output.buffer.equals(video)).toBe(true)
        expect(output.jobId).toBe('interaction-1')
      })
      await Promise.all([
        completion,
        vi.advanceTimersByTimeAsync(0).then(() => vi.advanceTimersByTimeAsync(5000)),
      ])
      expect(submissions).toBe(1)
    })

    it.each([
      { state: 'FAILED', error: /Google video processing failed/ },
      { state: 'PROCESSING', error: /Google video processing timed out/ },
    ])('does not download a file that remains $state', async ({ state, error }) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(jsonResponse(completed()))
          .mockImplementation(() => Promise.resolve(jsonResponse({ state })))
      )
      const rejection = expect(
        generateVideo(input, { requestId: 'google-processing' })
      ).rejects.toThrow(error)
      await Promise.all([rejection, vi.advanceTimersByTimeAsync(5000)])
      expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    })

    it('stops during Files processing without downloading or polling again', async () => {
      const controller = new AbortController()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(completed()))
        .mockResolvedValueOnce(jsonResponse({ state: 'PROCESSING' }))
      vi.stubGlobal('fetch', fetchMock)
      const result = generateVideo(input, {
        requestId: 'google-stopped',
        signal: controller.signal,
      })
      const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
      await Promise.all([
        rejection,
        vi.advanceTimersByTimeAsync(0).then(() => {
          controller.abort(new DOMException('Stopped', 'AbortError'))
        }),
      ])
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    })

    it.each([
      'https://foreign.example/v1beta/files/video-file:download?alt=media',
      'https://generativelanguage.googleapis.com/v1beta/models/model:download?alt=media',
      'https://generativelanguage.googleapis.com/v1beta/files/nested%2Ffile:download?alt=media',
    ])('rejects a non-Files download URI before sending credentials: %s', async (uri) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(completed(uri)))
      vi.stubGlobal('fetch', fetchMock)
      await expect(generateVideo(input, { requestId: 'google-invalid-uri' })).rejects.toThrow(
        /Invalid Google video file URI/
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    })

    it('keeps Files metadata within the ordinary JSON response limit', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(jsonResponse(completed()))
          .mockResolvedValueOnce(
            jsonResponse(
              { state: 'ACTIVE' },
              { headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) } }
            )
          )
      )
      await expect(
        generateVideo(input, { requestId: 'google-metadata-limit' })
      ).rejects.toMatchObject({
        name: 'PayloadSizeLimitError',
      })
      expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    })

    it('does not poll a full interaction when synchronous generation does not complete', async () => {
      const fetchMock = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(jsonResponse({ id: 'interaction-1', status: 'in_progress' }))
        )
      vi.stubGlobal('fetch', fetchMock)
      const rejection = expect(
        generateVideo(input, { requestId: 'google-incomplete' })
      ).rejects.toThrow(/Google synchronous video generation did not complete/)
      await Promise.all([rejection, vi.advanceTimersByTimeAsync(5000)])
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
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

  it.each([null, '', false, 0])(
    'ignores an empty camera control (%s) when submitting a Luma job',
    async (cameraControl) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ id: 'job' }))
        .mockResolvedValueOnce(
          jsonResponse({ state: 'completed', assets: { video: 'data:video/mp4;base64,dmlkZW8=' } })
        )
      vi.stubGlobal('fetch', fetchMock)
      const result = generateVideo(
        {
          provider: 'luma',
          model: 'ray-2',
          apiKey: 'key',
          prompt: 'A cinematic sunrise',
          cameraControl,
        },
        { requestId: 'empty-camera' }
      )
      const completion = expect(result).resolves.toMatchObject({ buffer: Buffer.from('video') })
      await Promise.all([completion, vi.advanceTimersByTimeAsync(5000)])
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty('concepts')
    }
  )

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

  it.each([
    {
      model: 'kling-v3-pro',
      endpoint: 'fal-ai/kling-video/v3/pro/image-to-video',
      imageField: 'start_image_url',
    },
    {
      model: 'veo-3.1',
      endpoint: 'fal-ai/veo3.1/image-to-video',
      imageField: 'image_url',
    },
  ])('sends a start frame to $endpoint as $imageField', async ({ model, endpoint, imageField }) => {
    fileUtilsServerMockFns.mockDownloadFileFromStorage.mockResolvedValueOnce(Buffer.from('png'))
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ request_id: 'fal-1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(jsonResponse({ video: { url: 'data:video/mp4;base64,dmlkZW8=' } }))
    vi.stubGlobal('fetch', mockFetch)
    const frame = { id: 'f', name: 'frame.png', url: '', size: 3, type: 'image/png', key: 'k' }

    const result = generateVideo(
      { provider: 'falai', apiKey: 'key', model, prompt: 'Pan left', visualReference: frame },
      { requestId: 'request-1' }
    )
    await Promise.all([result, vi.advanceTimersByTimeAsync(5000)])

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(`https://queue.fal.run/${endpoint}`)
    expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))).toEqual(
      expect.objectContaining({
        prompt: 'Pan left',
        [imageField]: `data:image/png;base64,${Buffer.from('png').toString('base64')}`,
      })
    )
  })

  it.each([
    { provider: 'falai' as const, model: 'kling-v3-pro' },
    { provider: 'runway' as const, model: 'gen4_turbo' },
  ])(
    'rejects a non-image reference file for $provider before submitting',
    ({ provider, model }) => {
      const pdf = {
        id: 'f',
        name: 'brief.pdf',
        url: '',
        size: 3,
        type: 'application/pdf',
        key: 'k',
      }
      expect(
        getVideoInputValidationError({
          provider,
          apiKey: 'key',
          model,
          prompt: 'Pan left',
          visualReference: pdf,
        })
      ).toBe('Reference image must be an image file, not application/pdf')
    }
  )

  it('rejects a start frame for a fal model without an image-to-video endpoint', () => {
    const frame = { id: 'f', name: 'frame.png', url: '', size: 3, type: 'image/png', key: 'k' }
    expect(
      getVideoInputValidationError({
        provider: 'falai',
        apiKey: 'key',
        model: 'minimax/h3-max/styles/vhs',
        prompt: 'Pan left',
        visualReference: frame,
      })
    ).toBe('Fal.ai model minimax/h3-max/styles/vhs does not accept a start frame image')
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

  it.each([422, 500])(
    'does not reconcile a failed fal result (HTTP %i) as delivered media',
    async (status) => {
      const paths: string[] = []
      vi.stubGlobal('fetch', async (url: string | URL) => {
        const path = new URL(url).pathname
        paths.push(path)
        if (path.endsWith('/status')) return jsonResponse({ status: 'COMPLETED' })
        if (path.includes('/requests/'))
          return jsonResponse(
            {
              detail: [
                { type: 'no_media_generated', msg: 'secret-prompt', input: 'secret-prompt' },
              ],
            },
            status
          )
        if (path.endsWith('/billing-events')) return jsonResponse({ billing_events: [] })
        if (path.endsWith('/estimate')) return jsonResponse({ total_cost: 0.25 })
        return jsonResponse({ request_id: 'failed-result' })
      })
      const pending: string[] = []
      const result = observeServiceCosts(
        async () => {},
        () =>
          executeVideoOperation(
            {
              provider: 'falai',
              model: 'veo-3.1',
              prompt: 'A sunrise',
              apiKey: 'key',
              useHostedCostTracking: true,
            },
            { requestId: 'trace', userId: 'user', headers: new Headers() }
          ),
        async (receipt) => {
          pending.push(receipt)
        }
      )
      const rejection = expect(result).rejects.toMatchObject({
        status: status === 422 ? 422 : 502,
        message: expect.stringContaining('no_media_generated'),
      })
      await Promise.all([rejection, vi.advanceTimersByTimeAsync(6000)])
      expect(pending).toEqual([])
      expect(paths.some((path) => path.endsWith('/estimate'))).toBe(false)
    }
  )

  it.each([
    { status: 429, body: 'Rate limit exceeded' },
    { status: 503, body: '<html>Service unavailable</html>' },
  ])(
    'retains reconciliation when result retrieval fails with HTTP $status',
    async ({ status, body }) => {
      let submissions = 0
      vi.stubGlobal('fetch', async (url: string | URL) => {
        const path = new URL(url).pathname
        if (path.endsWith('/status')) return jsonResponse({ status: 'COMPLETED' })
        if (path.includes('/requests/')) return new Response(body, { status })
        if (path.endsWith('/billing-events')) return jsonResponse({ billing_events: [] })
        if (path.endsWith('/estimate')) return jsonResponse({ total_cost: 0.25 })
        submissions++
        return jsonResponse({ request_id: `unavailable-${status}` })
      })
      const receipts: string[] = []
      const result = observeServiceCosts(
        async () => {},
        () =>
          executeVideoOperation(
            {
              provider: 'falai',
              model: 'veo-3.1',
              prompt: 'A sunrise',
              apiKey: `delivery-${status}`,
              useHostedCostTracking: true,
            },
            { requestId: 'trace', userId: 'user', headers: new Headers() }
          ),
        async (receipt) => {
          receipts.push(receipt)
        }
      )
      const rejection = expect(result).rejects.toMatchObject({ status: 502 })
      await Promise.all([rejection, vi.advanceTimersByTimeAsync(6000)])
      expect(receipts).toHaveLength(1)
      expect(receipts[0]).toContain(`unavailable-${status}`)
      expect(receipts[0]).toContain('0.25 (historical_estimate)')
      expect(submissions).toBe(1)
    }
  )

  it.each(['headers', 'body'])(
    'captures the exact receipt before a stalled result %s settles',
    async (stall) => {
      let resultSignal: AbortSignal | null | undefined
      const costs: number[] = []
      vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
        const path = new URL(url).pathname
        if (path.endsWith('/status')) return jsonResponse({ status: 'COMPLETED' })
        if (path.endsWith('/billing-events'))
          return jsonResponse({
            billing_events: [
              {
                request_id: 'stalled-result',
                endpoint_id: 'fal-ai/veo3.1',
                cost_estimate_nano_usd: 400000000,
              },
            ],
          })
        if (path.includes('/requests/')) {
          resultSignal = init?.signal
          return stall === 'headers'
            ? new Promise<Response>(() => {})
            : new Response(
                new ReadableStream({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode('{'))
                  },
                })
              )
        }
        return jsonResponse({ request_id: 'stalled-result' })
      })
      const result = generateVideo(
        {
          provider: 'falai',
          model: 'veo-3.1',
          prompt: 'A sunrise',
          apiKey: 'stall-key',
          useHostedCostTracking: true,
        },
        {
          requestId: 'trace',
          onFalCost: (cost) => {
            costs.push(cost.costDollars)
          },
        }
      )
      let outcome: unknown = 'pending'
      void result.then(
        (value) => {
          outcome = value
        },
        (error) => {
          outcome = error
        }
      )
      await vi.advanceTimersByTimeAsync(5000)
      const earlyCosts = [...costs]
      await vi.advanceTimersByTimeAsync(30001)
      expect(earlyCosts).toEqual([0.4])
      expect(outcome).toMatchObject({ name: 'DeadlineExceededError' })
      expect(resultSignal?.aborted).toBe(true)
      expect(costs).toEqual([0.4])
    }
  )

  it('reconciles an exact receipt for a terminal queue error without fetching or estimating a result', async () => {
    const paths: string[] = []
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const path = new URL(url).pathname
      paths.push(path)
      if (path.endsWith('/status'))
        return jsonResponse({ status: 'COMPLETED', error: 'sensitive provider error' })
      if (path.endsWith('/billing-events'))
        return jsonResponse({
          billing_events: [
            {
              request_id: 'queue-error',
              endpoint_id: 'fal-ai/veo3.1',
              cost_estimate_nano_usd: 400000000,
            },
          ],
        })
      return jsonResponse({ request_id: 'queue-error' })
    })
    const receipts: string[] = []
    const result = observeServiceCosts(
      async () => {},
      () =>
        executeVideoOperation(
          {
            provider: 'falai',
            model: 'veo-3.1',
            prompt: 'A sunrise',
            apiKey: 'queue-key',
            useHostedCostTracking: true,
          },
          { requestId: 'trace', userId: 'user', headers: new Headers() }
        ),
      async (receipt) => {
        receipts.push(receipt)
      }
    )
    const rejected = expect(result).rejects.toThrow()
    await Promise.all([rejected, vi.advanceTimersByTimeAsync(5000)])
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toContain('0.4 (billing_events)')
    expect(
      paths.some((path) => path.endsWith('/estimate') || path.endsWith('/requests/queue-error'))
    ).toBe(false)
  })

  it('preserves an exact charge even when the provider returns a failed result', async () => {
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const path = new URL(url).pathname
      if (path.endsWith('/status')) return jsonResponse({ status: 'COMPLETED' })
      if (path.includes('/requests/'))
        return jsonResponse({ detail: [{ type: 'no_media_generated' }] }, 422)
      if (path.endsWith('/billing-events'))
        return jsonResponse({
          billing_events: [
            {
              request_id: 'charged-failure',
              endpoint_id: 'fal-ai/veo3.1',
              cost_estimate_nano_usd: 400000000,
            },
          ],
        })
      return jsonResponse({ request_id: 'charged-failure' })
    })
    const receipts: string[] = []
    const result = observeServiceCosts(
      async () => {},
      () =>
        executeVideoOperation(
          {
            provider: 'falai',
            model: 'veo-3.1',
            prompt: 'A sunrise',
            apiKey: 'key',
            useHostedCostTracking: true,
          },
          { requestId: 'trace', userId: 'user', headers: new Headers() }
        ),
      async (receipt) => {
        receipts.push(receipt)
      }
    )
    const rejection = expect(result).rejects.toMatchObject({ status: 422 })
    await Promise.all([rejection, vi.advanceTimersByTimeAsync(6000)])
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toContain('0.4 (billing_events)')
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
