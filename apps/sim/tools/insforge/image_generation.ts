import type {
  InsForgeImageGenerationParams,
  InsForgeImageGenerationResponse,
} from '@/tools/insforge/types'
import type { ToolConfig } from '@/tools/types'

export const imageGenerationTool: ToolConfig<
  InsForgeImageGenerationParams,
  InsForgeImageGenerationResponse
> = {
  id: 'insforge_image_generation',
  name: 'InsForge AI Image Generation',
  description: 'Generate images using InsForge AI',
  version: '1.0',

  params: {
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your InsForge backend URL (e.g., https://your-app.insforge.app)',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The image generation model to use (e.g., "dall-e-3")',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The prompt describing the image to generate',
    },
    size: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image size (e.g., "1024x1024", "1792x1024", "1024x1792")',
    },
    quality: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image quality ("standard" or "hd")',
    },
    n: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of images to generate (default: 1)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your InsForge anon key or service role key',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/ai/v1/images/generations`
    },
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        prompt: params.prompt,
      }

      if (params.model) {
        body.model = params.model
      }

      if (params.size) {
        body.size = params.size
      }

      if (params.quality) {
        body.quality = params.quality
      }

      if (params.n) {
        body.n = params.n
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse InsForge AI image generation response: ${parseError}`)
    }

    const images =
      data?.data?.map((img: { url: string; revised_prompt?: string }) => ({
        url: img.url,
        revisedPrompt: img.revised_prompt,
      })) || []

    return {
      success: true,
      output: {
        message: `Successfully generated ${images.length} image${images.length === 1 ? '' : 's'}`,
        images,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    images: { type: 'array', description: 'Array of generated images with URLs' },
  },
}
