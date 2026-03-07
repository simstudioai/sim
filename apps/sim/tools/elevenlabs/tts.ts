import { FLASH_TURBO_MODELS } from '@/tools/elevenlabs/constants'
import type { ElevenLabsTtsParams, ElevenLabsTtsResponse } from '@/tools/elevenlabs/types'
import type { ToolConfig } from '@/tools/types'

export const elevenLabsTtsTool: ToolConfig<ElevenLabsTtsParams, ElevenLabsTtsResponse> = {
  id: 'elevenlabs_tts',
  name: 'ElevenLabs TTS',
  description: 'Convert TTS using ElevenLabs voices',
  version: '1.0.0',

  hosting: {
    envKeyPrefix: 'ELEVENLABS_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'elevenlabs',
    pricing: {
      type: 'custom',
      getCost: (params, _output) => {
        const text = params.text as string | undefined
        if (!text) {
          throw new Error('Missing text parameter, cannot determine character cost')
        }
        const characterCount = text.length
        const modelId = (params.modelId as string) || 'eleven_monolingual_v1'
        // Flash/Turbo: $0.08/1K chars, Standard/Multilingual/v3: $0.18/1K chars
        // Scale tier additional character rates — https://elevenlabs.io/pricing/api
        const costPer1KChars = FLASH_TURBO_MODELS.has(modelId) ? 0.08 : 0.18
        const cost = (characterCount / 1000) * costPer1KChars
        return { cost, metadata: { characterCount, modelId, costPer1KChars } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 30,
    },
  },

  params: {
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text to convert to speech (e.g., "Hello, welcome to our service!")',
    },
    voiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the voice to use (e.g., "21m00Tcm4TlvDq8ikWAM" for Rachel)',
    },
    modelId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the model to use (e.g., "eleven_multilingual_v2", "eleven_turbo_v2"). Defaults to eleven_monolingual_v1',
    },
    stability: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Voice stability setting from 0.0 to 1.0 (e.g., 0.5 for balanced, 0.75 for more stable). Higher values produce more consistent output',
    },
    similarity: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Similarity boost setting from 0.0 to 1.0 (e.g., 0.75 for natural, 1.0 for maximum similarity). Higher values make the voice more similar to the original',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your ElevenLabs API key',
    },
  },

  request: {
    url: '/api/tools/tts',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: ElevenLabsTtsParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      apiKey: params.apiKey,
      text: params.text,
      voiceId: params.voiceId,
      modelId: params.modelId || 'eleven_monolingual_v1',
      stability: params.stability,
      similarity: params.similarity,
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
        error: data.error || 'Unknown error occurred',
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
      },
    }
  },

  outputs: {
    audioUrl: { type: 'string', description: 'The URL of the generated audio' },
    audioFile: { type: 'file', description: 'The generated audio file' },
  },
}
