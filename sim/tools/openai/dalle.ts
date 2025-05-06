import { ToolConfig } from '../types'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('DalleTool')

export const dalleTool: ToolConfig = {
  id: 'openai_dalle',
  name: 'DALL-E Generate',
  description: "Generate images using OpenAI's DALL-E model",
  version: '1.0.0',
  params: {
    prompt: {
      type: 'string',
      required: true,
      description: 'A text description of the desired image(s)',
    },
    model: {
      type: 'string',
      required: true,
      description: 'The DALL-E model to use (dall-e-2 or dall-e-3)',
    },
    size: {
      type: 'string',
      required: false,
      description: 'The size of the generated images (1024x1024, 1024x1792, or 1792x1024)',
    },
    quality: {
      type: 'string',
      required: false,
      description: 'The quality of the image (standard or hd)',
    },
    style: {
      type: 'string',
      required: false,
      description: 'The style of the image (vivid or natural)',
    },
    n: {
      type: 'number',
      required: false,
      description: 'The number of images to generate (1-10)',
    },
    apiKey: {
      type: 'string',
      required: true,
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
    body: (params) => ({
      model: params.model,
      prompt: params.prompt,
      size: params.size || '1024x1024',
      quality: params.quality || 'standard',
      style: params.style || 'vivid',
      n: params.n || 1,
    }),
  },
  transformResponse: async (response, params) => {
    try {
      const data = await response.json()

      logger.info('DALL-E API response:', JSON.stringify(data, null, 2))

      if (!data.data?.[0]?.url) {
        logger.error('No image URL in DALL-E response:', data)
        throw new Error('No image URL in response')
      }

      const imageUrl = data.data[0].url
      const modelName = data.model || params?.model || 'dall-e'

      logger.info('Got image URL:', imageUrl)
      logger.info('Using model:', modelName)

      try {
        // Fetch the image using the proxy/image endpoint instead of direct fetch
        logger.info('Fetching image from URL via proxy...')
        // Get the base URL from environment or use a fallback
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        const proxyUrl = new URL(`/api/proxy/image`, baseUrl)
        proxyUrl.searchParams.append('url', imageUrl)

        const imageResponse = await fetch(proxyUrl.toString(), {
          headers: {
            Accept: 'image/*, */*',
          },
          cache: 'no-store', // Don't use cache
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
        const base64Image = buffer.toString('base64')
        
        return {
          success: true,
          output: {
            content: imageUrl, // Now using image URL as content
            image: base64Image, // Base64 image in separate field
            metadata: {
              model: modelName, // Only include model name in metadata
            },
          },
        }
      } catch (error) {
        // Log the error but continue with returning the URL
        logger.error('Error fetching or processing image:', error)

        // Try again with a direct browser fetch as fallback
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

          // Server-side safe way to convert blob to base64
          const arrayBuffer = await imageBlob.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)
          const base64Image = buffer.toString('base64')
          
          logger.info(
            'Successfully converted image to base64 via direct fetch, length:',
            base64Image.length
          )

          return {
            success: true,
            output: {
              content: imageUrl,
              image: base64Image,
              metadata: {
                model: modelName,
              },
            },
          }
        } catch (fallbackError) {
          logger.error('Fallback fetch also failed:', fallbackError)

          // Even if both attempts fail, still return the URL and metadata
          return {
            success: true,
            output: {
              content: imageUrl, // URL as content
              image: '', // Empty image since we couldn't get it
              metadata: {
                model: modelName,
              },
            },
          }
        }
      }
    } catch (error) {
      logger.error('Error in DALL-E response handling:', error)
      throw error
    }
  },
  transformError: (error) => {
    logger.error('DALL-E error:', error)
    if (error.response?.data?.error?.message) {
      return error.response.data.error.message
    }
    return error.message || 'Failed to generate image with DALL-E'
  },
}
