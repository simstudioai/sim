import type {
  ElevenLabsGetVoiceSettingsParams,
  ElevenLabsGetVoiceSettingsResponse,
} from '@/tools/elevenlabs/types'
import type { ToolConfig } from '@/tools/types'

export const elevenLabsGetVoiceSettingsTool: ToolConfig<
  ElevenLabsGetVoiceSettingsParams,
  ElevenLabsGetVoiceSettingsResponse
> = {
  id: 'elevenlabs_get_voice_settings',
  name: 'ElevenLabs Get Voice Settings',
  description: 'Get the configured settings for a specific ElevenLabs voice',
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
      description: 'The ID of the voice whose settings to retrieve',
    },
  },

  request: {
    url: (params) => `https://api.elevenlabs.io/v1/voices/${params.voiceId.trim()}/settings`,
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
        stability: data.stability ?? null,
        similarityBoost: data.similarity_boost ?? null,
        style: data.style ?? null,
        useSpeakerBoost: data.use_speaker_boost ?? null,
        speed: data.speed ?? null,
      },
    }
  },

  outputs: {
    stability: { type: 'number', description: 'Voice stability (0.0-1.0)' },
    similarityBoost: { type: 'number', description: 'Similarity boost (0.0-1.0)' },
    style: { type: 'number', description: 'Style exaggeration (0.0-1.0)' },
    useSpeakerBoost: { type: 'boolean', description: 'Whether speaker boost is enabled' },
    speed: { type: 'number', description: 'Speech speed (1.0 = normal)' },
  },
}
