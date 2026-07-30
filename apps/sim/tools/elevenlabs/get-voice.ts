import type { ElevenLabsGetVoiceParams, ElevenLabsGetVoiceResponse } from '@/tools/elevenlabs/types'
import type { ToolConfig } from '@/tools/types'

export const elevenLabsGetVoiceTool: ToolConfig<
  ElevenLabsGetVoiceParams,
  ElevenLabsGetVoiceResponse
> = {
  id: 'elevenlabs_get_voice',
  name: 'ElevenLabs Get Voice',
  description: 'Get metadata and settings for a specific ElevenLabs voice',
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
      description: 'The ID of the voice to retrieve (e.g., "21m00Tcm4TlvDq8ikWAM")',
    },
  },

  request: {
    url: (params) => `https://api.elevenlabs.io/v1/voices/${params.voiceId.trim()}`,
    method: 'GET',
    headers: (params) => ({
      'xi-api-key': params.apiKey,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        voiceId: data.voice_id,
        name: data.name ?? null,
        category: data.category ?? null,
        description: data.description ?? null,
        labels: data.labels ?? null,
        previewUrl: data.preview_url ?? null,
        settings: data.settings ?? null,
        availableForTiers: data.available_for_tiers ?? [],
        highQualityBaseModelIds: data.high_quality_base_model_ids ?? [],
        isOwner: data.is_owner ?? null,
      },
    }
  },

  outputs: {
    voiceId: { type: 'string', description: 'Unique voice identifier' },
    name: { type: 'string', description: 'Voice name' },
    category: { type: 'string', description: 'Voice category' },
    description: { type: 'string', description: 'Voice description' },
    labels: { type: 'json', description: 'Voice labels (accent, gender, age, use case)' },
    previewUrl: { type: 'string', description: 'URL to a preview audio sample' },
    settings: { type: 'json', description: 'Default voice settings' },
    availableForTiers: {
      type: 'array',
      description: 'Subscription tiers the voice is available on',
    },
    highQualityBaseModelIds: {
      type: 'array',
      description: 'Model IDs that support high-quality output for this voice',
    },
    isOwner: { type: 'boolean', description: 'Whether the current user owns this voice' },
  },
}
