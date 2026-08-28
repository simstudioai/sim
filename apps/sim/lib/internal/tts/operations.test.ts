/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  synthesizeAzure: vi.fn(),
  synthesizeCartesia: vi.fn(),
  synthesizeDeepgram: vi.fn(),
  synthesizeElevenLabs: vi.fn(),
  synthesizeGoogle: vi.fn(),
  synthesizeLegacyElevenLabs: vi.fn(),
  synthesizeOpenAi: vi.fn(),
  synthesizePlayHt: vi.fn(),
  uploadExecutionFile: vi.fn(),
  uploadFile: vi.fn(),
}))

vi.mock('@/lib/internal/tts/client', () => ({
  synthesizeAzure: mocks.synthesizeAzure,
  synthesizeCartesia: mocks.synthesizeCartesia,
  synthesizeDeepgram: mocks.synthesizeDeepgram,
  synthesizeElevenLabs: mocks.synthesizeElevenLabs,
  synthesizeGoogle: mocks.synthesizeGoogle,
  synthesizeLegacyElevenLabs: mocks.synthesizeLegacyElevenLabs,
  synthesizeOpenAi: mocks.synthesizeOpenAi,
  synthesizePlayHt: mocks.synthesizePlayHt,
}))
vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.uploadExecutionFile,
}))
vi.mock('@/lib/uploads', () => ({
  StorageService: { uploadFile: mocks.uploadFile },
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.example' }))

import {
  executeAzureTts,
  executeCartesiaTts,
  executeDeepgramTts,
  executeElevenLabsTts,
  executeGoogleTts,
  executeLegacyElevenLabsTts,
  executeOpenAiTts,
  executePlayHtTts,
} from '@/lib/internal/tts/operations'

const CONTEXT = {
  requestId: 'request-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
}

const AUDIO = {
  audioBuffer: Buffer.from('audio'),
  format: 'mp3',
  mimeType: 'audio/mpeg',
}

describe('TTS operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const synthesize of [
      mocks.synthesizeAzure,
      mocks.synthesizeCartesia,
      mocks.synthesizeDeepgram,
      mocks.synthesizeElevenLabs,
      mocks.synthesizeGoogle,
      mocks.synthesizeLegacyElevenLabs,
      mocks.synthesizeOpenAi,
      mocks.synthesizePlayHt,
    ]) {
      synthesize.mockResolvedValue(AUDIO)
    }
    mocks.uploadExecutionFile.mockResolvedValue({
      id: 'file-1',
      name: 'speech.mp3',
      url: 'https://execution.example/speech.mp3',
      size: AUDIO.audioBuffer.length,
      type: AUDIO.mimeType,
      key: 'execution/speech.mp3',
    })
    mocks.uploadFile.mockResolvedValue({
      key: 'copilot/speech.mp3',
      path: '/api/files/serve/copilot/speech.mp3',
      size: AUDIO.audioBuffer.length,
    })
  })

  it.each([
    [executeOpenAiTts, mocks.synthesizeOpenAi, { text: 'Hello', apiKey: 'key' }, 'openai'],
    [executeDeepgramTts, mocks.synthesizeDeepgram, { text: 'Hello', apiKey: 'key' }, 'deepgram'],
    [
      executeElevenLabsTts,
      mocks.synthesizeElevenLabs,
      { text: 'Hello', apiKey: 'key', voiceId: 'voice_1' },
      'elevenlabs',
    ],
    [executeCartesiaTts, mocks.synthesizeCartesia, { text: 'Hello', apiKey: 'key' }, 'cartesia'],
    [executeGoogleTts, mocks.synthesizeGoogle, { text: 'Hello', apiKey: 'key' }, 'google'],
    [executeAzureTts, mocks.synthesizeAzure, { text: 'Hello', apiKey: 'key' }, 'azure'],
    [
      executePlayHtTts,
      mocks.synthesizePlayHt,
      { text: 'Hello', apiKey: 'key', userId: 'playht-user' },
      'playht',
    ],
  ] as const)(
    'selects the provider client and stores %s output in trusted execution scope',
    async (execute, synthesize, input, provider) => {
      const controller = new AbortController()
      const result = await execute(input, { ...CONTEXT, signal: controller.signal })

      expect(synthesize).toHaveBeenCalledWith(input, controller.signal)
      expect(mocks.uploadExecutionFile).toHaveBeenCalledWith(
        {
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        },
        AUDIO.audioBuffer,
        expect.stringMatching(new RegExp(`^tts-${provider}-\\d+\\.mp3$`)),
        AUDIO.mimeType,
        'user-1'
      )
      expect(result).toMatchObject({
        audioUrl: 'https://execution.example/speech.mp3',
        audioFile: { id: 'file-1' },
        characterCount: 5,
        format: 'mp3',
        provider,
      })
    }
  )

  it('uses copilot storage when no complete execution scope exists', async () => {
    const result = await executeOpenAiTts(
      { text: 'Hello', apiKey: 'key' },
      { requestId: 'request-1', userId: 'user-1' }
    )

    expect(mocks.uploadExecutionFile).not.toHaveBeenCalled()
    expect(mocks.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'copilot', file: AUDIO.audioBuffer })
    )
    expect(result).toEqual({
      audioUrl: 'https://sim.example/api/files/serve/copilot/speech.mp3',
      characterCount: 5,
      format: 'mp3',
      provider: 'openai',
    })
  })

  it('preserves the legacy ElevenLabs output contract', async () => {
    const result = await executeLegacyElevenLabsTts(
      { text: 'Hello', apiKey: 'key', voiceId: 'voice_1' },
      CONTEXT
    )

    expect(mocks.synthesizeLegacyElevenLabs).toHaveBeenCalledWith(
      { text: 'Hello', apiKey: 'key', voiceId: 'voice_1' },
      undefined
    )
    expect(result).toEqual({
      audioFile: expect.objectContaining({ id: 'file-1' }),
      audioUrl: 'https://execution.example/speech.mp3',
    })
  })

  it('does not start storage after synthesis cancellation', async () => {
    const controller = new AbortController()
    mocks.synthesizeOpenAi.mockImplementation(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      return AUDIO
    })

    await expect(
      executeOpenAiTts({ text: 'Hello', apiKey: 'key' }, { ...CONTEXT, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.uploadExecutionFile).not.toHaveBeenCalled()
    expect(mocks.uploadFile).not.toHaveBeenCalled()
  })
})
