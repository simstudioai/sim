import { createLogger } from '@/lib/logs/console-logger'
import { getBaseUrl } from '@/lib/urls/utils'
import type { ToolConfig } from '../types'
import type { BaseImageRequestBody } from './types'

const logger = createLogger('ImageTool')

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
      description: 'The model to use (gpt-image-1 or dall-e-3)',
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
      description: 'The size of the generated images (1024x1024, 1024x1792, or 1792x1024)',
    },
    quality: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The quality of the image (standard or hd)',
    },
    style: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The style of the image (vivid or natural)',
    },
    background: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The background color, only for gpt-image-1',
    },
    n: {
      type: 'number',
      required: false,
      visibility: 'hidden',
      description: 'The number of images to generate (1-10)',
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
      const body: BaseImageRequestBody = {
        model: params.model,
        prompt: params.prompt,
        size: params.size || '1024x1024',
        n: params.n || 1,
      }

      // Add model-specific parameters
      if (params.model === 'dall-e-3') {
        if (params.quality) body.quality = params.quality
        if (params.style) body.style = params.style
      } else if (params.model === 'gpt-image-1') {
        if (params.background) body.background = params.background
      }

      return body
    },
  },
  transformResponse: async (response, params) => {
    try {
      const data = await response.json()

      const sanitizedData = JSON.parse(JSON.stringify(data))
      if (sanitizedData.data && Array.isArray(sanitizedData.data)) {
        sanitizedData.data.forEach((item: { b64_json?: string }) => {
          if (item.b64_json) {
            item.b64_json = `[base64 data truncated, length: ${item.b64_json.length}]`
          }
        })
      }

      const modelName = params?.model || 'dall-e-3'
      let imageUrl = null
      let base64Image = null

      if (data.data?.[0]?.url) {
        imageUrl = data.data[0].url
        logger.info('Found image URL in response for DALL-E 3')
      } else if (data.data?.[0]?.b64_json) {
        base64Image = data.data[0].b64_json
        logger.info(
          'Found base64 encoded image in response for GPT-Image-1',
          `length: ${base64Image.length}`
        )
      } else {
        logger.error('No image data found in API response:', data)
        throw new Error('No image data found in response')
      }

      if (imageUrl && !base64Image) {
        try {
          logger.info('Fetching image from URL via proxy...')
          const baseUrl = getBaseUrl()
          const proxyUrl = new URL('/api/proxy/image', baseUrl)
          proxyUrl.searchParams.append('url', imageUrl)

          const imageResponse = await fetch(proxyUrl.toString(), {
            headers: {
              Accept: 'image/*, */*',
            },
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

          try {
            logger.info('Attempting fallback with direct browser fetch...')
            const directImageResponse = await fetch(imageUrl, {
              cache: 'no-store',
              headers: {
                Accept: 'image/*, */*',
                'User-Agent': 'Mozilla/5.0 (compatible DalleProxy/1.0)',
              },
            })

            if (!directImageResponse.ok) {
              throw new Error(`Direct fetch failed: ${directImageResponse.status}`)
            }

            const imageBlob = await directImageResponse.blob()
            if (imageBlob.size === 0) {
              throw new Error('Empty blob received from direct fetch')
            }

            const arrayBuffer = await imageBlob.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)
            base64Image = buffer.toString('base64')

            logger.info(
              'Successfully converted image to base64 via direct fetch, length:',
              base64Image.length
            )
          } catch (fallbackError) {
            logger.error('Fallback fetch also failed:', fallbackError)
          }
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
  transformError: (error) => {
    logger.error('Image generation error:', error)
    if (error.response?.data?.error?.message) {
      return error.response.data.error.message
    }
    return error.message || 'Failed to generate image'
  },
}
