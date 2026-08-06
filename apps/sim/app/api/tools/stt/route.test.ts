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
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

const {
  mockIsInternalFileUrl,
  mockDownloadFileFromStorage,
  mockIsModelSafeWorkspaceFileKey,
  mockResolveInternalFileUrl,
} = vi.hoisted(() => ({
  mockIsInternalFileUrl: vi.fn(),
  mockDownloadFileFromStorage: vi.fn(),
  mockIsModelSafeWorkspaceFileKey: vi.fn(),
  mockResolveInternalFileUrl: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  extractStorageKey: vi.fn(() => 'storage-key'),
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
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mockIsModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
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

function createVerifiedSttRequest(body: Record<string, unknown>) {
  return createMockRequest(
    'POST',
    {
      ...body,
      [RESOLVED_SECRET_PROVENANCE_FIELD]: {
        version: 1,
        complete: true,
        entries: [],
      },
    },
    { [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1 }
  )
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
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mockDownloadFileFromStorage.mockResolvedValue(Buffer.from('audio'))

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

    const response = await POST(createVerifiedSttRequest(baseBody))

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

    const response = await POST(createVerifiedSttRequest(baseBody))

    expect(response.status).toBe(200)
    const data = (await response.json()) as { transcript: string }
    expect(data.transcript).toBe('hello world')
  })

  it('rejects an authenticated but incomplete private provenance envelope before downloading', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          ...baseBody,
          [RESOLVED_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: false,
            entries: [],
          },
        },
        { [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1 }
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Model input provenance is unavailable' })
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts a verified empty private provenance envelope', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({})
    )

    const response = await POST(createVerifiedSttRequest(baseBody))

    expect(response.status).toBe(200)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledOnce()
  })

  it('rejects a tracked unsafe workspace audio file before reading its bytes', async () => {
    mockIsModelSafeWorkspaceFileKey.mockResolvedValueOnce(false)

    const response = await POST(
      createVerifiedSttRequest({
        provider: 'whisper',
        apiKey: 'test-api-key',
        audioFile: {
          id: 'file-1',
          name: 'audio.mp3',
          size: 5,
          type: 'audio/mpeg',
          key: 'workspace/workspace-1/audio.mp3',
        },
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'File cannot be sent to a model because its secret provenance is unavailable',
    })
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a tracked unsafe internal audio URL after access resolution', async () => {
    mockIsInternalFileUrl.mockReturnValue(true)
    mockResolveInternalFileUrl.mockResolvedValueOnce({
      fileUrl: 'https://storage.example.com/signed-audio.mp3',
    })
    mockIsModelSafeWorkspaceFileKey.mockResolvedValueOnce(false)

    const response = await POST(
      createVerifiedSttRequest({
        ...baseBody,
        audioUrl: '/api/files/serve/workspace/workspace-1/audio.mp3',
      })
    )

    expect(response.status).toBe(400)
    expect(mockResolveInternalFileUrl).toHaveBeenCalledOnce()
    expect(mockIsModelSafeWorkspaceFileKey).toHaveBeenCalledWith('storage-key')
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
