import type { GammaGenerateParams, GammaGenerateResponse } from '@/tools/gamma/types'
import type { ToolConfig } from '@/tools/types'

export const generateTool: ToolConfig<GammaGenerateParams, GammaGenerateResponse> = {
  id: 'gamma_generate',
  name: 'Gamma Generate',
  description:
    'Generate a new Gamma presentation, document, webpage, or social post from text input.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gamma API key',
    },
    inputText: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text and image URLs used to generate your gamma (1-100,000 tokens)',
    },
    textMode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'How to handle input text: generate (AI expands), condense (AI summarizes), or preserve (keep as-is)',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Output format: presentation, document, webpage, or social (default: presentation)',
    },
    themeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom Gamma workspace theme ID (use List Themes to find available themes)',
    },
    numCards: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of cards/slides to generate (1-60 for Pro, 1-75 for Ultra; default: 10)',
    },
    cardSplit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'How to split content into cards: auto or inputTextBreaks (default: auto)',
    },
    cardDimensions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Card aspect ratio. Presentation: fluid, 16x9, 4x3. Document: fluid, pageless, letter, a4. Social: 1x1, 4x5, 9x16',
    },
    additionalInstructions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional instructions for the AI generation (max 2000 chars)',
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
    textAmount: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amount of text per card: brief, medium, detailed, or extensive',
    },
    textTone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tone of the generated text, e.g. "professional", "casual" (max 500 chars)',
    },
    textAudience: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Target audience for the generated text, e.g. "executives", "students" (max 500 chars)',
    },
    textLanguage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code for the generated text (default: en)',
    },
    imageSource: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Where to source images: aiGenerated, pictographic, unsplash, webAllImages, webFreeToUse, webFreeToUseCommercially, giphy, placeholder, or noImages',
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
    url: 'https://public-api.gamma.app/v1.0/generations',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'X-API-KEY': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        inputText: params.inputText,
        textMode: params.textMode,
      }

      if (params.format) body.format = params.format
      if (params.themeId) body.themeId = params.themeId
      if (params.numCards) body.numCards = params.numCards
      if (params.cardSplit) body.cardSplit = params.cardSplit
      if (params.additionalInstructions) body.additionalInstructions = params.additionalInstructions
      if (params.exportAs) body.exportAs = params.exportAs
      if (params.folderIds) {
        body.folderIds = params.folderIds.split(',').map((id: string) => id.trim())
      }

      const textOptions: Record<string, unknown> = {}
      if (params.textAmount) textOptions.amount = params.textAmount
      if (params.textTone) textOptions.tone = params.textTone
      if (params.textAudience) textOptions.audience = params.textAudience
      if (params.textLanguage) textOptions.language = params.textLanguage
      if (Object.keys(textOptions).length > 0) body.textOptions = textOptions

      const imageOptions: Record<string, unknown> = {}
      if (params.imageSource) imageOptions.source = params.imageSource
      if (params.imageModel) imageOptions.model = params.imageModel
      if (params.imageStyle) imageOptions.style = params.imageStyle
      if (Object.keys(imageOptions).length > 0) body.imageOptions = imageOptions

      const cardOptions: Record<string, unknown> = {}
      if (params.cardDimensions) cardOptions.dimensions = params.cardDimensions
      if (Object.keys(cardOptions).length > 0) body.cardOptions = cardOptions

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
