import type {
  ElevenLabsEditVoiceSettingsParams,
  ElevenLabsEditVoiceSettingsResponse,
} from '@/tools/elevenlabs/types'
import type { ToolConfig } from '@/tools/types'

export const elevenLabsEditVoiceSettingsTool: ToolConfig<
  ElevenLabsEditVoiceSettingsParams,
  ElevenLabsEditVoiceSettingsResponse
> = {
  id: 'elevenlabs_edit_voice_settings',
  name: 'ElevenLabs Edit Voice Settings',
  description: 'Update the settings for a specific ElevenLabs voice',
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
      description: 'The ID of the voice to update',
    },
    stability: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Voice stability from 0.0 to 1.0 (default 0.5)',
    },
    similarityBoost: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Similarity boost from 0.0 to 1.0 (default 0.75)',
    },
    style: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Style exaggeration from 0.0 to 1.0 (default 0)',
    },
    useSpeakerBoost: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to enhance similarity to the original speaker (default true)',
    },
    speed: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Speech speed where 1.0 is normal (default 1.0)',
    },
  },

  request: {
    url: (params) => `https://api.elevenlabs.io/v1/voices/${params.voiceId.trim()}/settings/edit`,
    method: 'POST',
    headers: (params) => ({
      'xi-api-key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.stability !== undefined) body.stability = params.stability
      if (params.similarityBoost !== undefined) body.similarity_boost = params.similarityBoost
      if (params.style !== undefined) body.style = params.style
      if (params.useSpeakerBoost !== undefined) body.use_speaker_boost = params.useSpeakerBoost
      if (params.speed !== undefined) body.speed = params.speed
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        status: data.status ?? 'ok',
      },
    }
  },

  outputs: {
    status: { type: 'string', description: 'Request outcome ("ok" on success)' },
  },
}
