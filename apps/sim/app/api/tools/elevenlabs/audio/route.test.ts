/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

const { mockDownloadFileFromStorage, mockIsModelSafeWorkspaceFileKey, mockUploadFile } = vi.hoisted(
  () => ({
    mockDownloadFileFromStorage: vi.fn(),
    mockIsModelSafeWorkspaceFileKey: vi.fn(),
    mockUploadFile: vi.fn(),
  })
)

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mockDownloadFileFromStorage,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mockIsModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))
vi.mock('@/lib/uploads', () => ({
  StorageService: { uploadFile: mockUploadFile },
}))
vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}))

import { POST } from '@/app/api/tools/elevenlabs/audio/route'

const audioFile = {
  id: 'file-1',
  name: 'audio.wav',
  size: 5,
  type: 'audio/wav',
  key: 'workspace/workspace-1/audio.wav',
}

describe('POST /api/tools/elevenlabs/audio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mockDownloadFileFromStorage.mockResolvedValue(Buffer.from('audio'))
    mockUploadFile.mockResolvedValue({ path: '/api/files/serve/generated.mp3', size: 3 })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        })
      )
    )
  })

  it('keeps headerless sound-effect calls compatible', async () => {
    const response = await POST(
      createMockRequest('POST', {
        operation: 'sound_effects',
        apiKey: 'test-api-key',
        text: 'A soft chime',
      })
    )

    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledOnce()
    expect(mockIsModelSafeWorkspaceFileKey).not.toHaveBeenCalled()
  })

  it('rejects an incomplete private provenance envelope before reading audio bytes', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'audio_isolation',
          apiKey: 'test-api-key',
          audioFile,
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
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects tracked unsafe audio before reading or sending it', async () => {
    mockIsModelSafeWorkspaceFileKey.mockResolvedValueOnce(false)

    const response = await POST(
      createMockRequest(
        'POST',
        {
          operation: 'audio_isolation',
          apiKey: 'test-api-key',
          audioFile,
          [RESOLVED_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: true,
            entries: [],
          },
        },
        { [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1 }
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'File cannot be sent to a model because its secret provenance is unavailable',
    })
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
