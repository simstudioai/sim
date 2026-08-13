/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { deepgramSttTool } from '@/tools/stt/deepgram'
import { whisperSttTool } from '@/tools/stt/whisper'

const AUDIO_FILE = {
  id: 'audio-1',
  name: 'secret-recording.mp3',
  size: 42,
  type: 'audio/mpeg',
  key: 'workspace/ws-1/secret-recording.mp3',
  url: 'https://storage.example/audio.mp3?signature=private',
  base64: 'raw-inline-field',
}

describe('STT model input provenance', () => {
  it('does not attach opaque provenance for server-resolved audio locators', () => {
    const modelInput = deepgramSttTool.request.modelInput
    expect(modelInput?.mode).toBe('project')
    if (modelInput?.mode !== 'project') throw new Error('Expected Deepgram to project input')
    expect(modelInput.privateInputPaths).toBeUndefined()
  })

  it('projects the Whisper filename while preserving its locator and inline fields', () => {
    const modelInput = whisperSttTool.request.modelInput
    expect(modelInput?.mode).toBe('project')
    if (modelInput?.mode !== 'project' || !modelInput.applyProjected) {
      throw new Error('Expected Whisper to apply projected input')
    }

    const selected = modelInput.select({
      provider: 'whisper',
      apiKey: 'key',
      audioFile: AUDIO_FILE,
      language: 'en',
      prompt: 'hint',
    })
    expect(selected).toEqual({
      language: 'en',
      prompt: 'hint',
      audioFile: { name: 'secret-recording.mp3' },
    })
    expect(
      modelInput.applyProjected(
        { audioFile: AUDIO_FILE, language: 'en', prompt: 'hint' },
        {
          language: 'en',
          prompt: 'hint',
          audioFile: { name: '{{FILE_NAME}}' },
        }
      )
    ).toEqual({
      language: 'en',
      prompt: 'hint',
      audioFile: { ...AUDIO_FILE, name: '{{FILE_NAME}}' },
    })
    expect(modelInput.privateInputPaths).toBeUndefined()
  })
})
