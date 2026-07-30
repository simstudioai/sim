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
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const { mockIsInternalFileUrl, mockDownloadFileFromStorage, mockResolveInternalFileUrl } =
  vi.hoisted(() => ({
    mockIsInternalFileUrl: vi.fn(),
    mockDownloadFileFromStorage: vi.fn(),
    mockResolveInternalFileUrl: vi.fn(),
  }))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  isInternalFileUrl: mockIsInternalFileUrl,
  getMimeTypeFromExtension: vi.fn(() => 'application/octet-stream'),
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mockDownloadFileFromStorage,
  resolveInternalFileUrl: mockResolveInternalFileUrl,
}))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/audio/extractor', () => ({
  isVideoFile: vi.fn(() => false),
  extractAudioFromVideo: vi.fn(),
}))

import { POST } from '@/app/api/tools/stt/route'

const PINNED_IP = '93.184.216.34'

const baseBody = {
  provider: 'whisper',
  apiKey: 'test-api-key',
  audioUrl: 'https://example.com/audio.mp3',
}

function mockSecureFetchResponse(body: { ok?: boolean; contentType?: string }) {
  return {
    ok: body.ok ?? true,
    status: 200,
    statusText: '',
    headers: new Headers({ 'content-type': body.contentType ?? 'audio/mpeg' }),
    body: null,
    text: async () => '',
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(8),
  }
}

describe('POST /api/tools/stt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: PINNED_IP,
      originalHostname: 'example.com',
    })
    mockIsInternalFileUrl.mockReturnValue(false)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'hello world', language: 'en', duration: 1.2 }),
      })
    )
  })

  it('bounds the audioUrl download and rejects oversized responses cleanly', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockRejectedValueOnce(
      new PayloadSizeLimitError({
        label: 'response body',
        maxBytes: 100 * 1024 * 1024,
        observedBytes: 200 * 1024 * 1024,
      })
    )

    const response = await POST(createMockRequest('POST', baseBody))

    expect(response.status).toBe(413)
    const data = (await response.json()) as { error: string }
    expect(data.error).toMatch(/exceeds the maximum supported size/i)

    const call = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0]
    expect(call[1]).toBe(PINNED_IP)
    expect(call[2]).toMatchObject({ maxResponseBytes: 100 * 1024 * 1024 })
  })

  it('transcribes a normal, well-under-cap audio download successfully', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({})
    )

    const response = await POST(createMockRequest('POST', baseBody))

    expect(response.status).toBe(200)
    const data = (await response.json()) as { transcript: string }
    expect(data.transcript).toBe('hello world')
  })
})
