import { inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import { filesAuthorizationMock } from '@sim/testing/mocks/files-authorization.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

const { mockIsInternalFileUrl, mockExtractStorageKey, mockGetMimeTypeFromExtension } =
  fileUtilsMockFns
const { mockDownloadFileFromStorage, mockResolveInternalFileUrl } = fileUtilsServerMockFns
const { mockIsModelSafeWorkspaceFileKey } = workspaceFileSecretProvenanceMockFns

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)
vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)
vi.mock('@/lib/audio/extractor', () => ({
  isVideoFile: vi.fn(() => false),
  extractAudioFromVideo: vi.fn(),
}))

import { executeSttTool } from '@/lib/internal/stt/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const PINNED_IP = '93.184.216.34'

const baseBody = {
  provider: 'whisper',
  apiKey: 'test-api-key',
  audioUrl: 'https://example.com/audio.mp3',
}

function createSttRequest(
  input: Record<string, unknown>,
  headers = new Headers(),
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'stt_whisper',
    input,
    headers,
    context: {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

function createVerifiedSttRequest(
  body: Record<string, unknown>,
  overrides: Partial<InternalToolOperationCall> = {}
) {
  return createSttRequest(
    {
      ...body,
      [RESOLVED_SECRET_PROVENANCE_FIELD]: {
        version: 1,
        complete: true,
        entries: [],
      },
    },
    new Headers({
      [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    }),
    overrides
  )
}

describe('executeSttTool', () => {
  beforeEach(() => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: PINNED_IP,
      originalHostname: 'example.com',
    })
    mockIsInternalFileUrl.mockReturnValue(false)
    mockExtractStorageKey.mockReturnValue('storage-key')
    mockGetMimeTypeFromExtension.mockReturnValue('application/octet-stream')
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

    const response = await executeSttTool(createVerifiedSttRequest(baseBody))

    expect(response.status).toBe(413)
    const data = (await response.json()) as { error: string }
    expect(data.error).toMatch(/exceeds the maximum supported size/i)

    const call = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0]
    expect(call[1]).toBe(PINNED_IP)
    expect(call[2]).toMatchObject({ maxResponseBytes: 100 * 1024 * 1024 })
  })

  it('rejects an authenticated but incomplete private provenance envelope before downloading', async () => {
    const response = await executeSttTool(
      createSttRequest(
        {
          ...baseBody,
          [RESOLVED_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: false,
            entries: [],
          },
        },
        new Headers({
          [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
        })
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Model input provenance is unavailable' })
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a tracked unsafe workspace audio file before reading its bytes', async () => {
    mockIsModelSafeWorkspaceFileKey.mockResolvedValueOnce(false)

    const response = await executeSttTool(
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

    const response = await executeSttTool(
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
