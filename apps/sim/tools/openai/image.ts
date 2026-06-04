import { createLogger } from '@sim/logger'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import type { BaseImageRequestBody } from '@/tools/openai/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ImageTool')

const GPT_IMAGE_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536'] as const
const GPT_IMAGE_2_SIZES = [...GPT_IMAGE_SIZES, '2560x1440', '3840x2160'] as const
const GPT_IMAGE_MODELS = [
  'gpt-image-2',
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
] as const

export const imageTool: ToolConfig = {
  id: 'openai_image',
  name: 'Image Generator',
  description: "Generate images using OpenAI's Image models",
  version: '1.0.0',

  params: {
    model: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'The model to use. Supports dall-e-3, gpt-image-2, gpt-image-1.5, gpt-image-1, and gpt-image-1-mini.',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'A text description of the desired image',
    },
    size: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Image size. dall-e-3: 1024x1024, 1024x1792, or 1792x1024. GPT Image models: auto, 1024x1024, 1536x1024, or 1024x1536. gpt-image-2 also supports 2560x1440 and 3840x2160.',
    },
    quality: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Quality. dall-e-3: standard|hd. GPT Image models: auto|low|medium|high',
    },
    style: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The style of the image (vivid or natural), only for dall-e-3',
    },
    background: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Background for GPT Image models: auto|transparent|opaque',
    },
    outputFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Output image format (png, jpeg, webp), only for GPT Image models',
    },
    moderation: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Moderation level (auto or low), only for GPT Image models',
    },
    n: {
      type: 'number',
      required: false,
      visibility: 'hidden',
      description: 'Reserved for legacy callers. This tool returns a single generated image.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your OpenAI API key',
    },
  },

  request: {
    url: 'https://api.openai.com/v1/images/generations',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const requestedModel = String(params.model || 'dall-e-3')
      const requestedSize = String(params.size || '')
      const size =
        requestedModel === 'dall-e-3'
          ? ['1024x1024', '1024x1792', '1792x1024'].includes(requestedSize)
            ? requestedSize
            : '1024x1024'
          : requestedModel === 'gpt-image-2' &&
              GPT_IMAGE_2_SIZES.includes(requestedSize as (typeof GPT_IMAGE_2_SIZES)[number])
            ? requestedSize
            : GPT_IMAGE_MODELS.includes(requestedModel as (typeof GPT_IMAGE_MODELS)[number]) &&
                GPT_IMAGE_SIZES.includes(requestedSize as (typeof GPT_IMAGE_SIZES)[number])
              ? requestedSize
              : 'auto'
      const body: BaseImageRequestBody = {
        model: requestedModel,
        prompt: params.prompt,
        size,
        n: 1,
      }

      if (requestedModel === 'dall-e-3') {
        if (params.quality) body.quality = params.quality
        if (params.style) body.style = params.style
      } else if (GPT_IMAGE_MODELS.includes(requestedModel as (typeof GPT_IMAGE_MODELS)[number])) {
        if (params.quality) body.quality = params.quality
        if (params.background) body.background = params.background
        if (params.outputFormat) body.output_format = params.outputFormat
        if (params.moderation) body.moderation = params.moderation
      }

      return body
    },
  },

  transformResponse: async (response, params) => {
    try {
      const data = await response.json()

      const sanitizedData = structuredClone(data)
      if (sanitizedData.data && Array.isArray(sanitizedData.data)) {
        sanitizedData.data.forEach((item: { b64_json?: string }) => {
          if (item.b64_json) {
            item.b64_json = `[base64 data truncated, length: ${item.b64_json.length}]`
          }
        })
      }

      const modelName = String(params?.model || 'dall-e-3')
      let imageUrl = null
      let base64Image = null

      if (data.data?.[0]?.url) {
        imageUrl = data.data[0].url
        logger.info('Found image URL in response for DALL-E 3')
      } else if (data.data?.[0]?.b64_json) {
        base64Image = data.data[0].b64_json
        logger.info(
          `Found base64 encoded image in response for ${modelName}`,
          `length: ${base64Image.length}`
        )
      } else {
        logger.error('No image data found in API response:', data)
        throw new Error('No image data found in response')
      }

      if (imageUrl && !base64Image) {
        try {
          logger.info('Fetching image from URL via proxy...')
          const baseUrl = getInternalApiBaseUrl()
          const proxyUrl = new URL('/api/tools/image', baseUrl)
          proxyUrl.searchParams.append('url', imageUrl)

          const headers: Record<string, string> = {
            Accept: 'image/*, */*',
          }

          if (typeof window === 'undefined') {
            const { generateInternalToken } = await import('@/lib/auth/internal')
            try {
              const token = await generateInternalToken()
              headers.Authorization = `Bearer ${token}`
              logger.info('Added internal auth token for image proxy request')
            } catch (error) {
              logger.error('Failed to generate internal token for image proxy:', error)
            }
          }

          const imageResponse = await fetch(proxyUrl.toString(), {
            headers,
            cache: 'no-store',
          })

          if (!imageResponse.ok) {
            logger.error('Failed to fetch image:', imageResponse.status, imageResponse.statusText)
            throw new Error(`Failed to fetch image: ${imageResponse.statusText}`)
          }

          const imageBlob = await imageResponse.blob()

          if (imageBlob.size === 0) {
            logger.error('Empty image blob received')
            throw new Error('Empty image received')
          }

          const arrayBuffer = await imageBlob.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)
          base64Image = buffer.toString('base64')
        } catch (error) {
          logger.error('Error fetching or processing image:', error)
        }
      }

      return {
        success: true,
        output: {
          content: imageUrl || 'direct-image',
          image: base64Image || '',
          metadata: {
            model: modelName,
          },
        },
      }
    } catch (error) {
      logger.error('Error in image generation response handling:', error)
      throw error
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Generated image data',
      properties: {
        content: { type: 'string', description: 'Image URL or identifier' },
        image: { type: 'string', description: 'Base64 encoded image data' },
        metadata: {
          type: 'object',
          description: 'Image generation metadata',
          properties: {
            model: { type: 'string', description: 'Model used for image generation' },
          },
        },
      },
    },
  },
}
