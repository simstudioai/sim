import type { ToolConfig } from '@/tools/types'
import type { TtsBlockResponse } from '@/tools/tts/types'

export interface ModelsLabTtsParams {
  text: string
  voice_id?: string
  language?: string
  speed?: number
  apiKey: string
}

export const modelsLabTtsTool: ToolConfig<ModelsLabTtsParams, TtsBlockResponse> = {
  id: 'tts_modelslab',
  name: 'ModelsLab TTS',
  description: 'Convert text to speech using ModelsLab voices',
  version: '1.0.0',

  params: {
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text content to convert to speech',
    },
    voice_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ModelsLab voice identifier (default: "madison")',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code (e.g., "en", "es", "fr")',
    },
    speed: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Speech speed (0.5 to 2.0, default: 1.0)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ModelsLab API key',
    },
  },

  request: {
    url: '/api/tools/tts/unified',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: ModelsLabTtsParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'modelslab',
      text: params.text,
      apiKey: params.apiKey,
      voice_id: params.voice_id || 'madison',
      language: params.language || 'en',
      speed: params.speed ?? 1.0,
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
