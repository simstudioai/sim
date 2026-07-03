import type {
  ElevenLabsListModelsParams,
  ElevenLabsListModelsResponse,
  ElevenLabsModelSummary,
} from '@/tools/elevenlabs/types'
import type { ToolConfig } from '@/tools/types'

export const elevenLabsListModelsTool: ToolConfig<
  ElevenLabsListModelsParams,
  ElevenLabsListModelsResponse
> = {
  id: 'elevenlabs_list_models',
  name: 'ElevenLabs List Models',
  description: 'List the models available in ElevenLabs',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your ElevenLabs API key',
    },
  },

  request: {
    url: 'https://api.elevenlabs.io/v1/models',
    method: 'GET',
    headers: (params) => ({
      'xi-api-key': params.apiKey,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const models: ElevenLabsModelSummary[] = (Array.isArray(data) ? data : []).map(
      (model: any) => ({
        modelId: model.model_id,
        name: model.name ?? null,
        description: model.description ?? null,
        canDoTextToSpeech: model.can_do_text_to_speech ?? null,
        canDoVoiceConversion: model.can_do_voice_conversion ?? null,
        canUseStyle: model.can_use_style ?? null,
        canUseSpeakerBoost: model.can_use_speaker_boost ?? null,
        languages: (model.languages ?? []).map((language: any) => ({
          languageId: language.language_id ?? null,
          name: language.name ?? null,
        })),
      })
    )

    return {
      success: true,
      output: { models },
    }
  },

  outputs: {
    models: {
      type: 'array',
      description: 'List of available models',
      items: {
        type: 'object',
        properties: {
          modelId: { type: 'string', description: 'Unique model identifier' },
          name: { type: 'string', description: 'Model name' },
          description: { type: 'string', description: 'Model description' },
          canDoTextToSpeech: { type: 'boolean', description: 'Supports text-to-speech' },
          canDoVoiceConversion: { type: 'boolean', description: 'Supports voice conversion' },
          canUseStyle: { type: 'boolean', description: 'Supports the style parameter' },
          canUseSpeakerBoost: { type: 'boolean', description: 'Supports speaker boost' },
          languages: {
            type: 'array',
            description: 'Languages supported by the model',
            items: {
              type: 'object',
              properties: {
                languageId: { type: 'string', description: 'Language code' },
                name: { type: 'string', description: 'Language name' },
              },
            },
          },
        },
      },
    },
  },
}
