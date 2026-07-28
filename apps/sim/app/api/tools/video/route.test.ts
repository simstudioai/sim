/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FAL_QUEUE_JSON_BYTES } from '@/lib/media/falai'

const { mockUploadFile } = vi.hoisted(() => ({
  mockUploadFile: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/core/execution-limits', () => ({ getMaxExecutionTimeout: () => 30_000 }))
vi.mock('@sim/utils/helpers', () => ({ sleep: () => Promise.resolve() }))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/uploads', () => ({
  StorageService: { uploadFile: mockUploadFile },
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.test' }))

import { POST } from '@/app/api/tools/video/route'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

function jsonResponse(payload: unknown) {
  const text = JSON.stringify(payload)
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: null,
    text: async () => text,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function videoResponse() {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => {
        if (name === 'content-type') return 'video/mp4'
        return name === 'content-length' ? '8' : null
      },
    },
    body: null,
    text: async () => '',
    arrayBuffer: async () => new ArrayBuffer(8),
  }
}

function errorResponse(status: number) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    body: null,
    text: async () => 'denied',
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

const baseBody = {
  provider: 'falai',
  apiKey: 'fal-key',
  model: 'kling-v3-pro',
  prompt: 'a cat riding a bike',
}

describe('POST /api/tools/video (Fal.ai queue)', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '8.8.8.8' })
    mockUploadFile.mockResolvedValue({ path: '/api/files/serve/video.mp4' })
  })

  it('normalizes the echoed /response URL and bounds queue reads with the shared Fal cap', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          request_id: 'req-1',
          status_url: 'https://queue.fal.run/fal-ai/kling-video/requests/req-1/status',
          response_url: 'https://queue.fal.run/fal-ai/kling-video/requests/req-1/response',
        }),
        { status: 200 }
      )
    )
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(jsonResponse({ video: { url: 'https://cdn.fal.media/a.mp4' } }))
      .mockResolvedValueOnce(videoResponse())

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(200)

    const [statusCall, resultCall, downloadCall] = mockSecureFetchWithPinnedIP.mock.calls
    expect(statusCall[0]).toBe('https://queue.fal.run/fal-ai/kling-video/requests/req-1/status')
    // `/response` is not a GET route on queue.fal.run — it must be stripped.
    expect(resultCall[0]).toBe('https://queue.fal.run/fal-ai/kling-video/requests/req-1')
    expect(downloadCall[0]).toBe('https://cdn.fal.media/a.mp4')

    expect(statusCall[2].maxResponseBytes).toBe(MAX_FAL_QUEUE_JSON_BYTES)
    expect(resultCall[2].maxResponseBytes).toBe(MAX_FAL_QUEUE_JSON_BYTES)
  })

  it('falls back to the constructed multi-segment queue URL when the candidate is off-origin', async () => {
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
      .mockResolvedValueOnce(videoResponse())

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(200)

    // `fal-ai/kling-video/v3/pro/text-to-video` polls under the app id only.
    expect(mockSecureFetchWithPinnedIP.mock.calls.slice(0, 2).map(([url]) => url)).toEqual([
      'https://queue.fal.run/fal-ai/kling-video/requests/req-2/status',
      'https://queue.fal.run/fal-ai/kling-video/requests/req-2',
    ])
  })
})

/**
 * Runway, Veo, Luma and MiniMax all download the finished asset through
 * `downloadVideoFromUrl` (the SSRF-guarded client), each with its own label and
 * error prefix. These cover that plumbing per provider.
 */
describe('POST /api/tools/video (provider download paths)', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '8.8.8.8' })
    mockUploadFile.mockResolvedValue({ path: '/api/files/serve/video.mp4' })
  })

  function apiResponse(payload: unknown) {
    return new Response(JSON.stringify(payload), { status: 200 })
  }

  function veoFetches(uri: string) {
    fetchMock.mockResolvedValueOnce(apiResponse({ name: 'operations/op-1' })).mockResolvedValueOnce(
      apiResponse({
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri } }] } },
      })
    )
  }

  it('downloads the Runway asset through the guarded client', async () => {
    fetchMock
      .mockResolvedValueOnce(apiResponse({ id: 'task-1' }))
      .mockResolvedValueOnce(
        apiResponse({ status: 'SUCCEEDED', output: ['https://cdn.runwayml.test/a.mp4'] })
      )
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(videoResponse())

    const response = await POST(
      createMockRequest('POST', {
        provider: 'runway',
        apiKey: 'runway-key',
        model: 'gen-4',
        prompt: 'a cat riding a bike',
      })
    )

    expect(response.status).toBe(200)
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)
    expect(mockSecureFetchWithPinnedIP.mock.calls[0][0]).toBe('https://cdn.runwayml.test/a.mp4')
    expect(mockSecureFetchWithPinnedIP.mock.calls[0][2].headers).toBeUndefined()
  })

  it('surfaces the default download error prefix when the Runway asset fetch fails', async () => {
    fetchMock
      .mockResolvedValueOnce(apiResponse({ id: 'task-1' }))
      .mockResolvedValueOnce(
        apiResponse({ status: 'SUCCEEDED', output: ['https://cdn.runwayml.test/a.mp4'] })
      )
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(errorResponse(401))

    const response = await POST(
      createMockRequest('POST', {
        provider: 'runway',
        apiKey: 'runway-key',
        model: 'gen-4',
        prompt: 'a cat riding a bike',
      })
    )

    expect(response.status).toBe(500)
    expect((await response.json()).error).toBe('Failed to download video: 401')
  })

  it('downloads the Luma asset through the guarded client', async () => {
    fetchMock
      .mockResolvedValueOnce(apiResponse({ id: 'gen-1' }))
      .mockResolvedValueOnce(
        apiResponse({ state: 'completed', assets: { video: 'https://cdn.lumalabs.test/a.mp4' } })
      )
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(videoResponse())

    const response = await POST(
      createMockRequest('POST', {
        provider: 'luma',
        apiKey: 'luma-key',
        model: 'ray-2',
        prompt: 'a cat riding a bike',
      })
    )

    expect(response.status).toBe(200)
    expect(mockSecureFetchWithPinnedIP.mock.calls[0][0]).toBe('https://cdn.lumalabs.test/a.mp4')
    expect(mockSecureFetchWithPinnedIP.mock.calls[0][2].headers).toBeUndefined()
  })

  it('keeps the MiniMax-specific download error prefix', async () => {
    fetchMock
      .mockResolvedValueOnce(apiResponse({ base_resp: { status_code: 0 }, task_id: 'task-1' }))
      .mockResolvedValueOnce(
        apiResponse({ base_resp: { status_code: 0 }, status: 'Success', file_id: 'file-1' })
      )
      .mockResolvedValueOnce(
        apiResponse({ file: { download_url: 'https://cdn.minimax.test/a.mp4' } })
      )
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(errorResponse(401))

    const response = await POST(
      createMockRequest('POST', {
        provider: 'minimax',
        apiKey: 'minimax-key',
        model: 'hailuo-2.3',
        prompt: 'a cat riding a bike',
      })
    )

    expect(response.status).toBe(500)
    expect((await response.json()).error).toBe('Failed to download video from URL: 401')
  })

  it('downloads the MiniMax asset through the guarded client', async () => {
    fetchMock
      .mockResolvedValueOnce(apiResponse({ base_resp: { status_code: 0 }, task_id: 'task-1' }))
      .mockResolvedValueOnce(
        apiResponse({ base_resp: { status_code: 0 }, status: 'Success', file_id: 'file-1' })
      )
      .mockResolvedValueOnce(
        apiResponse({ file: { download_url: 'https://cdn.minimax.test/a.mp4' } })
      )
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(videoResponse())

    const response = await POST(
      createMockRequest('POST', {
        provider: 'minimax',
        apiKey: 'minimax-key',
        model: 'hailuo-2.3',
        prompt: 'a cat riding a bike',
      })
    )

    expect(response.status).toBe(200)
    expect(mockSecureFetchWithPinnedIP.mock.calls[0][0]).toBe('https://cdn.minimax.test/a.mp4')
  })

  it('attaches the Veo API key only for a genuine https Google API host', async () => {
    veoFetches('https://generativelanguage.googleapis.com/v1beta/files/a:download')
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(videoResponse())

    const response = await POST(
      createMockRequest('POST', {
        provider: 'veo',
        apiKey: 'veo-key',
        model: 'veo-3',
        prompt: 'a cat riding a bike',
      })
    )

    expect(response.status).toBe(200)
    expect(mockSecureFetchWithPinnedIP.mock.calls[0][2].headers).toEqual({
      'x-goog-api-key': 'veo-key',
    })
  })

  it.each([
    ['a suffix-spoofed host', 'https://evil.googleapis.com.attacker.test/a.mp4'],
    ['a prefix-spoofed host', 'https://xgoogleapis.com/a.mp4'],
    ['plaintext http', 'http://generativelanguage.googleapis.com/a.mp4'],
  ])('withholds the Veo API key for %s', async (_label, uri) => {
    veoFetches(uri)
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(videoResponse())

    const response = await POST(
      createMockRequest('POST', {
        provider: 'veo',
        apiKey: 'veo-key',
        model: 'veo-3',
        prompt: 'a cat riding a bike',
      })
    )

    expect(response.status).toBe(200)
    expect(mockSecureFetchWithPinnedIP.mock.calls[0][0]).toBe(uri)
    expect(mockSecureFetchWithPinnedIP.mock.calls[0][2].headers).toBeUndefined()
  })
})
