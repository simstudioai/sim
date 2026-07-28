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
