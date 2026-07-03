import type {
  ElevenLabsAudioResponse,
  ElevenLabsSpeechToSpeechParams,
} from '@/tools/elevenlabs/types'
import type { ToolConfig } from '@/tools/types'

export const elevenLabsSpeechToSpeechTool: ToolConfig<
  ElevenLabsSpeechToSpeechParams,
  ElevenLabsAudioResponse
> = {
  id: 'elevenlabs_speech_to_speech',
  name: 'ElevenLabs Speech to Speech',
  description: 'Convert audio into a chosen ElevenLabs voice while preserving content and emotion',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your ElevenLabs API key',
    },
    voiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the target voice to convert the audio into',
    },
    audioFile: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'The source audio file to convert (e.g., MP3, WAV, M4A)',
    },
    modelId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The model to use (defaults to eleven_english_sts_v2)',
    },
    removeBackgroundNoise: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to isolate the voice and remove background noise (default false)',
    },
  },

  request: {
    url: '/api/tools/elevenlabs/audio',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: ElevenLabsSpeechToSpeechParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      operation: 'speech_to_speech',
      apiKey: params.apiKey,
      voiceId: params.voiceId,
      audioFile: params.audioFile,
      modelId: params.modelId,
      removeBackgroundNoise: params.removeBackgroundNoise,
      workspaceId: params._context?.workspaceId,
      workflowId: params._context?.workflowId,
      executionId: params._context?.executionId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error || 'Speech-to-speech conversion failed',
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
    audioUrl: { type: 'string', description: 'URL of the converted audio' },
    audioFile: { type: 'file', description: 'The converted audio file' },
  },
}
