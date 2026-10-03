import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import {
  uploadsExecutionMock,
  uploadsExecutionMockFns,
} from '@sim/testing/mocks/uploads-execution.mock'
import { resetUrlsMock, urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  synthesizeAzure: vi.fn(),
  synthesizeCartesia: vi.fn(),
  synthesizeDeepgram: vi.fn(),
  synthesizeElevenLabs: vi.fn(),
  synthesizeGoogle: vi.fn(),
  synthesizeLegacyElevenLabs: vi.fn(),
  synthesizeOpenAi: vi.fn(),
  synthesizePlayHt: vi.fn(),
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
vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)
vi.mock('@/lib/uploads', () => uploadsMock)

import { executeOpenAiTts } from '@/lib/internal/tts/operations'

const { mockUploadExecutionFile } = uploadsExecutionMockFns

const { mockUploadFile } = storageServiceMockFns

const AUDIO = {
  audioBuffer: Buffer.from('audio'),
  format: 'mp3',
  mimeType: 'audio/mpeg',
}

describe('TTS operations', () => {
  afterAll(resetUrlsMock)

  beforeEach(() => {
    urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.example')
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
    mockUploadExecutionFile.mockResolvedValue({
      id: 'file-1',
      name: 'speech.mp3',
      url: 'https://execution.example/speech.mp3',
      size: AUDIO.audioBuffer.length,
      type: AUDIO.mimeType,
      key: 'execution/speech.mp3',
    })
    mockUploadFile.mockResolvedValue({
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

    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
    expect(mockUploadFile).toHaveBeenCalledWith(
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
