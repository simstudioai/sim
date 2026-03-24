import type { QuiverListModelsParams, QuiverListModelsResponse } from '@/tools/quiver/types'
import type { ToolConfig } from '@/tools/types'

export const quiverListModelsTool: ToolConfig<QuiverListModelsParams, QuiverListModelsResponse> = {
  id: 'quiver_list_models',
  name: 'Quiver List Models',
  description: 'List all available QuiverAI models',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'QuiverAI API key',
    },
  },

  request: {
    url: 'https://api.quiver.ai/v1/models',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      let message = `Quiver API error: ${response.status}`
      try {
        const errorData = await response.json()
        message = errorData.message || message
      } catch {
        // Non-JSON error body (e.g. HTML from gateway)
      }
      throw new Error(message)
    }

    const data = await response.json()

    const models = (data.data ?? []).map(
      (model: {
        id: string
        name: string
        description: string
        created: number
        owned_by: string
        input_modalities: string[]
        output_modalities: string[]
        context_length: number
        max_output_length: number
        supported_operations: string[]
        supported_sampling_parameters: string[]
      }) => ({
        id: model.id ?? null,
        name: model.name ?? null,
        description: model.description ?? null,
        created: model.created ?? null,
        ownedBy: model.owned_by ?? null,
        inputModalities: model.input_modalities ?? [],
        outputModalities: model.output_modalities ?? [],
        contextLength: model.context_length ?? null,
        maxOutputLength: model.max_output_length ?? null,
        supportedOperations: model.supported_operations ?? [],
        supportedSamplingParameters: model.supported_sampling_parameters ?? [],
      })
    )

    return {
      success: true,
      output: {
        models,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the request succeeded' },
    output: {
      type: 'object',
      description: 'Available models',
      properties: {
        models: {
          type: 'json',
          description: 'List of available QuiverAI models',
          properties: {
            id: { type: 'string', description: 'Model identifier' },
            name: { type: 'string', description: 'Human-readable model name' },
            description: { type: 'string', description: 'Model capabilities summary' },
            created: { type: 'number', description: 'Unix timestamp of creation' },
            ownedBy: { type: 'string', description: 'Organization that owns the model' },
            inputModalities: {
              type: 'json',
              description: 'Supported input types (text, image, svg)',
            },
            outputModalities: {
              type: 'json',
              description: 'Supported output types (text, image, svg)',
            },
            contextLength: { type: 'number', description: 'Maximum context window' },
            maxOutputLength: { type: 'number', description: 'Maximum generation length' },
            supportedOperations: {
              type: 'json',
              description:
                'Available operations (svg_generate, svg_edit, svg_animate, svg_vectorize, chat_completions)',
            },
            supportedSamplingParameters: {
              type: 'json',
              description:
                'Supported sampling parameters (temperature, top_p, top_k, repetition_penalty, presence_penalty, stop)',
            },
          },
        },
      },
    },
  },
}
