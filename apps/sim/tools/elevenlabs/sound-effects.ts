import type {
  ElevenLabsAudioResponse,
  ElevenLabsSoundEffectsParams,
} from '@/tools/elevenlabs/types'
import type { ToolConfig } from '@/tools/types'

export const elevenLabsSoundEffectsTool: ToolConfig<
  ElevenLabsSoundEffectsParams,
  ElevenLabsAudioResponse
> = {
  id: 'elevenlabs_sound_effects',
  name: 'ElevenLabs Sound Effects',
  description: 'Generate a sound effect from a text prompt using ElevenLabs',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your ElevenLabs API key',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The prompt describing the sound effect (e.g., "thunder rumbling in the distance")',
    },
    modelId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The model to use (defaults to eleven_text_to_sound_v2)',
    },
    durationSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Length of the sound in seconds (0.5-30). Omit to auto-determine',
    },
    promptInfluence: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'How closely to follow the prompt from 0.0 to 1.0 (default 0.3)',
    },
    loop: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to generate a seamlessly looping sound effect (default false)',
    },
  },

  request: {
    url: '/api/tools/elevenlabs/audio',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: ElevenLabsSoundEffectsParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      operation: 'sound_effects',
      apiKey: params.apiKey,
      text: params.text,
      modelId: params.modelId,
      durationSeconds: params.durationSeconds,
      promptInfluence: params.promptInfluence,
      loop: params.loop,
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
        error: data.error || 'Sound effect generation failed',
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
    audioUrl: { type: 'string', description: 'URL of the generated sound effect' },
    audioFile: { type: 'file', description: 'The generated sound effect file' },
  },
}
