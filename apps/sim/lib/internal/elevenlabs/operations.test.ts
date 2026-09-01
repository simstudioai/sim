/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadFileFromStorage: vi.fn(),
  generateElevenLabsAudio: vi.fn(),
  isModelSafeWorkspaceFileKey: vi.fn(),
  storageUpload: vi.fn(),
  uploadExecutionFile: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/internal/elevenlabs/client', () => ({
  generateElevenLabsAudio: mocks.generateElevenLabsAudio,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mocks.downloadFileFromStorage,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mocks.isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))
vi.mock('@/lib/uploads', () => ({
  StorageService: { uploadFile: mocks.storageUpload },
}))
vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.uploadExecutionFile,
}))
vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'https://sim.example.com',
}))

import {
  executeElevenLabsAudioIsolation,
  executeElevenLabsSoundEffects,
  executeElevenLabsSpeechToSpeech,
} from '@/lib/internal/elevenlabs/operations'

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
    vi.clearAllMocks()
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.downloadFileFromStorage.mockResolvedValue(Buffer.from('source-audio'))
    mocks.generateElevenLabsAudio.mockResolvedValue(Buffer.from('result-audio'))
    mocks.isModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mocks.storageUpload.mockResolvedValue({ path: '/generated.mp3', size: 12 })
    mocks.uploadExecutionFile.mockResolvedValue({
      ...audioFile,
      name: 'generated.mp3',
      url: 'https://storage.example.com/generated.mp3',
    })
  })

  it('keeps headerless sound-effect execution compatible', async () => {
    await expect(
      executeElevenLabsSoundEffects({ apiKey: 'secret', text: 'A soft chime' }, context)
    ).resolves.toEqual({ audioUrl: 'https://sim.example.com/generated.mp3', size: 12 })

    expect(mocks.generateElevenLabsAudio).toHaveBeenCalledWith(
      { operation: 'sound_effects', input: { apiKey: 'secret', text: 'A soft chime' } },
      undefined
    )
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
    expect(mocks.downloadFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.generateElevenLabsAudio).not.toHaveBeenCalled()
  })

  it('rejects unsafe tracked audio before reading or sending it', async () => {
    mocks.isModelSafeWorkspaceFileKey.mockResolvedValue(false)

    await expect(
      executeElevenLabsAudioIsolation({ apiKey: 'secret', audioFile }, context)
    ).rejects.toMatchObject({
      status: 400,
      body: {
        error: 'File cannot be sent to a model because its secret provenance is unavailable',
      },
    })
    expect(mocks.downloadFileFromStorage).not.toHaveBeenCalled()
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

    expect(mocks.uploadExecutionFile).toHaveBeenCalledWith(
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

  it('preserves file authorization before speech voice validation', async () => {
    mocks.assertToolFileAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )

    await expect(
      executeElevenLabsSpeechToSpeech({ apiKey: 'secret', audioFile }, context)
    ).rejects.toMatchObject({ status: 404 })
  })
})
