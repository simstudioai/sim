import type {
  GammaGenerateFromTemplateParams,
  GammaGenerateFromTemplateResponse,
} from '@/tools/gamma/types'
import type { ToolConfig } from '@/tools/types'

export const generateFromTemplateTool: ToolConfig<
  GammaGenerateFromTemplateParams,
  GammaGenerateFromTemplateResponse
> = {
  id: 'gamma_generate_from_template',
  name: 'Gamma Generate from Template',
  description: 'Generate a new Gamma by adapting an existing template with a prompt.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gamma API key',
    },
    gammaId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the template gamma to adapt',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Instructions for how to adapt the template (1-100,000 tokens)',
    },
    themeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom Gamma workspace theme ID to apply',
    },
    exportAs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Automatically export the generated gamma as pdf or pptx',
    },
    folderIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated folder IDs to store the generated gamma in',
    },
    imageModel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'AI image generation model to use when imageSource is aiGenerated',
    },
    imageStyle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Style directive for AI-generated images, e.g. "watercolor", "photorealistic" (max 500 chars)',
    },
  },

  request: {
    url: 'https://public-api.gamma.app/v1.0/generations/from-template',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'X-API-KEY': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        gammaId: params.gammaId,
        prompt: params.prompt,
      }

      if (params.themeId) body.themeId = params.themeId
      if (params.exportAs) body.exportAs = params.exportAs
      if (params.folderIds) {
        body.folderIds = params.folderIds.split(',').map((id: string) => id.trim())
      }

      const imageOptions: Record<string, unknown> = {}
      if (params.imageModel) imageOptions.model = params.imageModel
      if (params.imageStyle) imageOptions.style = params.imageStyle
      if (Object.keys(imageOptions).length > 0) body.imageOptions = imageOptions

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        generationId: data.generationId ?? '',
      },
    }
  },

  outputs: {
    generationId: {
      type: 'string',
      description: 'The ID of the generation job. Use with Check Status to poll for completion.',
    },
  },
}
