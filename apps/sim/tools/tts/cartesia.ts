import type { CartesiaTtsParams, TtsBlockResponse } from '@/tools/tts/types'
import type { ToolConfig } from '@/tools/types'

export const cartesiaTtsTool: ToolConfig<CartesiaTtsParams, TtsBlockResponse> = {
  id: 'tts_cartesia',
  name: 'Cartesia TTS',
  description: 'Convert text to speech using Cartesia Sonic (ultra-low latency)',
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
      description: 'Cartesia API key',
    },
    modelId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Model ID (sonic-english, sonic-multilingual)',
    },
    voice: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Voice ID or embedding',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Language code (en, es, fr, de, it, pt, etc.)',
    },
    outputFormat: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Output format configuration (container, encoding, sampleRate)',
    },
    speed: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Speed multiplier',
    },
    emotion: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: "Emotion tags for Sonic-3 (e.g., ['positivity:high'])",
    },
  },

  request: {
    url: '/api/proxy/tts/unified',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: CartesiaTtsParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'cartesia',
      text: params.text,
      apiKey: params.apiKey,
      modelId: params.modelId || 'sonic-3',
      voice: params.voice,
      language: params.language || 'en',
      outputFormat: params.outputFormat || {
        container: 'mp3',
        encoding: 'pcm_f32le',
        sampleRate: 44100,
      },
      speed: params.speed,
      emotion: params.emotion,
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
