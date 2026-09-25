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

import { executeOpenAiTts } from '@/lib/internal/tts/operations'

const AUDIO = {
  audioBuffer: Buffer.from('audio'),
  format: 'mp3',
  mimeType: 'audio/mpeg',
}

describe('TTS operations', () => {
  beforeEach(() => {
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
})
