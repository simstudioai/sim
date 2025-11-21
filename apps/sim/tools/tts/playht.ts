import type { PlayHtTtsParams, TtsBlockResponse } from '@/tools/tts/types'
import type { ToolConfig } from '@/tools/types'

export const playhtTtsTool: ToolConfig<PlayHtTtsParams, TtsBlockResponse> = {
  id: 'tts_playht',
  name: 'PlayHT TTS',
  description: 'Convert text to speech using PlayHT (voice cloning)',
  version: '1.0.0',

  params: {
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text to convert to speech',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PlayHT API key (AUTHORIZATION header)',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PlayHT user ID (X-USER-ID header)',
    },
    voice: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Voice ID or manifest URL',
    },
    quality: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Quality level (draft, standard, premium)',
    },
    outputFormat: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Output format (mp3, wav, ogg, flac, mulaw)',
    },
    speed: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Speed multiplier (0.5 to 2.0)',
    },
    temperature: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Creativity/randomness (0.0 to 2.0)',
    },
    voiceGuidance: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Voice stability (1.0 to 6.0)',
    },
    textGuidance: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Text adherence (1.0 to 6.0)',
    },
    sampleRate: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Sample rate (8000, 16000, 22050, 24000, 44100, 48000)',
    },
  },

  request: {
    url: '/api/proxy/tts/unified',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: PlayHtTtsParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'playht',
      text: params.text,
      apiKey: params.apiKey,
      userId: params.userId,
      voice: params.voice,
      quality: params.quality || 'standard',
      outputFormat: params.outputFormat || 'mp3',
      speed: params.speed ?? 1.0,
      temperature: params.temperature,
      voiceGuidance: params.voiceGuidance,
      textGuidance: params.textGuidance,
      sampleRate: params.sampleRate,
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
        error: data.error || 'TTS generation failed',
        output: {
          audioUrl: '',
        },
      }
    }

    return {
      success: true,
      output: {
        audioUrl: data.audioUrl,
        audioFile: data.audioFile,
        duration: data.duration,
        characterCount: data.characterCount,
        format: data.format,
        provider: data.provider,
      },
    }
  },

  outputs: {
    audioUrl: { type: 'string', description: 'URL to the generated audio file' },
    audioFile: { type: 'file', description: 'Generated audio file object' },
    duration: { type: 'number', description: 'Audio duration in seconds' },
    characterCount: { type: 'number', description: 'Number of characters processed' },
    format: { type: 'string', description: 'Audio format' },
    provider: { type: 'string', description: 'TTS provider used' },
  },
}
