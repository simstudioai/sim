import {
  applyProjectedElevenLabsAudioFileNameModelInput,
  selectElevenLabsAudioFileNameModelInput,
} from '@/tools/elevenlabs/model-input'
import type {
  ElevenLabsAudioIsolationParams,
  ElevenLabsAudioResponse,
} from '@/tools/elevenlabs/types'
import type { InternalToolConfig } from '@/tools/types'

export const elevenLabsAudioIsolationTool: InternalToolConfig<
  ElevenLabsAudioIsolationParams,
  ElevenLabsAudioResponse
> = {
  id: 'elevenlabs_audio_isolation',
  name: 'ElevenLabs Audio Isolation',
  description: 'Remove background noise from an audio file, isolating the speech using ElevenLabs',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your ElevenLabs API key',
    },
    audioFile: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'The audio file to isolate speech from (e.g., MP3, WAV, M4A)',
    },
  },

  operation: {
    modelInput: {
      mode: 'project',
      select: selectElevenLabsAudioFileNameModelInput,
      applyProjected: applyProjectedElevenLabsAudioFileNameModelInput,
    },
    input: (params) => ({
      apiKey: params.apiKey,
      audioFile: params.audioFile,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error || 'Audio isolation failed',
        output: { audioUrl: '' },
      }
    }
    return {
      success: true,
      output: {
        audioUrl: data.audioUrl,
        audioFile: data.audioFile,
      },
    }
  },

  outputs: {
    audioUrl: { type: 'string', description: 'URL of the isolated audio' },
    audioFile: { type: 'file', description: 'The isolated audio file' },
  },
}
