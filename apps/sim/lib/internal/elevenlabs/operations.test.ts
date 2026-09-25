import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import {
  uploadsExecutionMock,
  uploadsExecutionMockFns,
} from '@sim/testing/mocks/uploads-execution.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

const mocks = vi.hoisted(() => ({
  generateElevenLabsAudio: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)
vi.mock('@/lib/internal/elevenlabs/client', () => ({
  generateElevenLabsAudio: mocks.generateElevenLabsAudio,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)
vi.mock('@/lib/uploads', () => uploadsMock)
vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadFileFromStorage } = fileUtilsServerMockFns
const { mockIsModelSafeWorkspaceFileKey } = workspaceFileSecretProvenanceMockFns
const { mockUploadFile } = storageServiceMockFns

urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.example.com')

import { executeElevenLabsAudioIsolation } from '@/lib/internal/elevenlabs/operations'

const { mockUploadExecutionFile } = uploadsExecutionMockFns

const audioFile = {
  id: 'file-1',
  name: 'audio.wav',
  size: 5,
  type: 'audio/wav',
  key: 'workspace/workspace-1/audio.wav',
}

const context = {
  headers: new Headers(),
  requestId: 'request-1',
  userId: 'user-1',
}

describe('ElevenLabs operations', () => {
  beforeEach(() => {
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadFileFromStorage.mockResolvedValue(Buffer.from('source-audio'))
    mocks.generateElevenLabsAudio.mockResolvedValue(Buffer.from('result-audio'))
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mockUploadFile.mockResolvedValue({ path: '/generated.mp3', size: 12 })
    mockUploadExecutionFile.mockResolvedValue({
      ...audioFile,
      name: 'generated.mp3',
      url: 'https://storage.example.com/generated.mp3',
    })
  })

  it('rejects incomplete private provenance before reading audio bytes', async () => {
    const headers = new Headers({
      [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })

    await expect(
      executeElevenLabsAudioIsolation(
        {
          apiKey: 'secret',
          audioFile,
          [RESOLVED_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: false,
            entries: [],
          },
        },
        { ...context, headers }
      )
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'Model input provenance is unavailable' },
    })
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.generateElevenLabsAudio).not.toHaveBeenCalled()
  })

  it('rejects unsafe tracked audio before reading or sending it', async () => {
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(false)

    await expect(
      executeElevenLabsAudioIsolation({ apiKey: 'secret', audioFile }, context)
    ).rejects.toMatchObject({
      status: 400,
      body: {
        error: 'File cannot be sent to a model because its secret provenance is unavailable',
      },
    })
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.generateElevenLabsAudio).not.toHaveBeenCalled()
  })

  it('uses only trusted execution scope when storing the result', async () => {
    const executionContext = {
      ...context,
      workspaceId: 'trusted-workspace',
      workflowId: 'trusted-workflow',
      executionId: 'trusted-execution',
    }
    const input = {
      apiKey: 'secret',
      audioFile,
      workspaceId: 'spoofed-workspace',
      workflowId: 'spoofed-workflow',
      executionId: 'spoofed-execution',
    }

    await executeElevenLabsAudioIsolation(input, executionContext)

    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
      {
        workspaceId: 'trusted-workspace',
        workflowId: 'trusted-workflow',
        executionId: 'trusted-execution',
      },
      Buffer.from('result-audio'),
      expect.stringMatching(/^elevenlabs-audio_isolation-\d+\.mp3$/),
      'audio/mpeg',
      'user-1'
    )
  })
})
