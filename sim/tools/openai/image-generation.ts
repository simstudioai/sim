import { z } from 'zod'
import { ToolConfig, ToolResponse } from '../types'

const imageGenerationSchema = z.object({
  provider: z.enum(['DALL-E', 'Stable Diffusion', 'Midjourney']),
  prompt: z.string(),
  apiKey: z.string(),
  resolution: z.string().optional(),
  quality: z.string().optional(),
  style: z.string().optional(),
  model: z.string().optional(),
  seed: z.string().optional(),
  outputFormat: z.string().optional(),
  negativePrompt: z.string().optional(),
  generationType: z.enum(['text-to-image', 'image-to-image', 'batch-generation']).optional(),
  sourceImage: z.string().optional(),
  imageStrength: z.string().optional(),
  batchPrompts: z.string().optional(),
  batchSize: z.string().optional()
})

type ImageGenerationParams = z.infer<typeof imageGenerationSchema>

export const imageGenerationTool: ToolConfig = {
  id: 'image_generation',
  name: 'Image Generation',
  description: 'Generate images using various AI providers',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      description: 'The AI provider to use (DALL-E, Stable Diffusion, or Midjourney)'
    },
    prompt: {
      type: 'string',
      required: true,
      description: 'The prompt to generate the image from'
    },
    apiKey: {
      type: 'string',
      required: true,
      description: 'API key for the selected provider'
    },
    resolution: {
      type: 'string',
      required: false,
      description: 'Image resolution (e.g., "1024x1024")'
    },
    quality: {
      type: 'string',
      required: false,
      description: 'Image quality (DALL-E only)'
    },
    style: {
      type: 'string',
      required: false,
      description: 'Image style (DALL-E only)'
    },
    model: {
      type: 'string',
      required: false,
      description: 'Model version to use'
    }
  },

  request: {
    url: (params: ImageGenerationParams) => {
      switch (params.provider) {
        case 'DALL-E':
          return 'https://api.openai.com/v1/images/generations'
        case 'Stable Diffusion':
          return 'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image'
        case 'Midjourney':
          return 'https://api.midjourney.com/v1/imagine'
        default:
          throw new Error(`Unsupported provider: ${params.provider}`)
      }
    },
    method: 'POST',
    headers: (params: ImageGenerationParams) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`
    }),
    body: (params: ImageGenerationParams) => {
      switch (params.provider) {
        case 'DALL-E':
          return {
            model: params.model || 'dall-e-2',
            prompt: params.prompt,
            n: params.generationType === 'batch-generation' ? parseInt(params.batchSize || '1') : 1,
            size: params.resolution || '1024x1024',
            response_format: 'url',
            ...(params.quality && { quality: params.quality }),
            ...(params.style && { style: params.style })
          }

        case 'Stable Diffusion':
          return {
            text_prompts: [
              { text: params.prompt, weight: 1 },
              ...(params.negativePrompt ? [{ text: params.negativePrompt, weight: -1 }] : [])
            ],
            cfg_scale: 7,
            height: parseInt(params.resolution?.split('x')[1] || '1024'),
            width: parseInt(params.resolution?.split('x')[0] || '1024'),
            samples: params.generationType === 'batch-generation' ? parseInt(params.batchSize || '1') : 1,
            steps: 30,
            style_preset: 'photographic'
          }

        case 'Midjourney':
          return {
            prompt: params.prompt,
            version: params.model || 'v6',
            aspect_ratio: params.resolution || '1:1',
            ...(params.seed && { seed: parseInt(params.seed) })
          }
      }
    }
  },

  transformResponse: async (response: Response, params: ImageGenerationParams): Promise<ToolResponse> => {
    const data = await response.json()

    let result
    switch (params.provider) {
      case 'DALL-E':
        result = {
          imageUrl: data.data[0].url,
          provider: params.provider,
          metadata: {
            prompt: params.prompt,
            width: parseInt(params.resolution?.split('x')[0] || '1024'),
            height: parseInt(params.resolution?.split('x')[1] || '1024'),
            model: params.model || 'dall-e-2',
            style: params.style,
            quality: params.quality,
            format: params.outputFormat || 'png'
          }
        }
        break

      case 'Stable Diffusion':
        result = {
          imageUrl: data.artifacts[0].base64,
          provider: params.provider,
          metadata: {
            prompt: params.prompt,
            width: parseInt(params.resolution?.split('x')[0] || '1024'),
            height: parseInt(params.resolution?.split('x')[1] || '1024'),
            model: 'stable-diffusion-xl',
            seed: data.artifacts[0].seed,
            format: params.outputFormat || 'png'
          }
        }
        break

      case 'Midjourney':
        result = {
          imageUrl: data.imageUrl,
          provider: params.provider,
          metadata: {
            prompt: params.prompt,
            width: 1024,
            height: 1024,
            model: params.model || 'v6',
            seed: params.seed ? parseInt(params.seed) : undefined,
            format: params.outputFormat || 'png'
          }
        }
        break
    }

    return {
      success: true,
      output: result
    }
  },

  transformError: (error: any): string => {
    if (error.response?.data?.error?.message) {
      return `Image generation failed: ${error.response.data.error.message}`
    }
    return error.message || 'Image generation failed'
  }
} 