/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { elevenLabsAudioIsolationTool } from '@/tools/elevenlabs/audio-isolation'
import { elevenLabsSoundEffectsTool } from '@/tools/elevenlabs/sound-effects'
import { elevenLabsSpeechToSpeechTool } from '@/tools/elevenlabs/speech-to-speech'

describe('ElevenLabs audio operation declarations', () => {
  it.each([elevenLabsSoundEffectsTool, elevenLabsSpeechToSpeechTool, elevenLabsAudioIsolationTool])(
    '$id has operation input and no HTTP metadata',
    (tool) => {
      expect(tool.operation.input).toBeTypeOf('function')
      expect('request' in tool).toBe(false)
    }
  )

  it('does not project untrusted execution scope into operation input', () => {
    const input = elevenLabsAudioIsolationTool.operation.input({
      apiKey: 'secret',
      audioFile: {
        id: 'file-1',
        name: 'audio.wav',
        size: 5,
        type: 'audio/wav',
        key: 'workspace/workspace-1/audio.wav',
      },
    })

    expect(input).toEqual({
      apiKey: 'secret',
      audioFile: expect.objectContaining({ key: 'workspace/workspace-1/audio.wav' }),
    })
    expect(input).not.toHaveProperty('workspaceId')
    expect(input).not.toHaveProperty('workflowId')
    expect(input).not.toHaveProperty('executionId')
  })
})
