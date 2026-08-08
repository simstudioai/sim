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

const { mockDownloadFileFromStorage, mockIsModelSafeWorkspaceFileKey } = vi.hoisted(() => ({
  mockDownloadFileFromStorage: vi.fn(),
  mockIsModelSafeWorkspaceFileKey: vi.fn(),
}))

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

import { POST } from '@/app/api/tools/video/route'

const baseBody = {
  provider: 'runway',
  apiKey: 'test-api-key',
  prompt: 'Generate a short test video',
  visualReference: {
    id: 'file-1',
    name: 'reference.png',
    size: 5,
    type: 'image/png',
    key: 'workspace/workspace-1/reference.png',
  },
}

describe('POST /api/tools/video', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mockDownloadFileFromStorage.mockResolvedValue(Buffer.from('image'))
  })

  it.each(['luma', 'veo', 'falai', 'minimax'])(
    'keeps the headerless projected %s path independent of opaque provenance',
    async (provider) => {
      const response = await POST(
        createMockRequest('POST', {
          provider,
          apiKey: 'test-api-key',
          prompt: 'x',
        })
      )

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'Prompt must be between 3 and 2000 characters',
      })
    }
  )

  it('rejects an incomplete private provenance envelope before inspecting the file', async () => {
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
    expect(mockIsModelSafeWorkspaceFileKey).not.toHaveBeenCalled()
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
  })

  it('rejects tracked unsafe files after accepting an exact empty opaque envelope', async () => {
    mockIsModelSafeWorkspaceFileKey.mockResolvedValueOnce(false)

    const response = await POST(
      createMockRequest(
        'POST',
        {
          ...baseBody,
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
    expect(mockIsModelSafeWorkspaceFileKey).toHaveBeenCalledWith(baseBody.visualReference.key)
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
  })
})
