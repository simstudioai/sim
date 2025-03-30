import { ToolConfig, ToolResponse } from '../types'

export interface DalleResponse extends ToolResponse {
  output: {
    content: string // This will now be the image URL
    image: string // This will be the base64 image data
    metadata: {
      model: string // Only contains model name now
    }
  }
}

export const dalleTool: ToolConfig = {
  id: 'dalle_generate',
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

      console.log('DALL-E API response:', JSON.stringify(data, null, 2))

      if (!data.data?.[0]?.url) {
        console.error('No image URL in DALL-E response:', data)
        throw new Error('No image URL in response')
      }

      const imageUrl = data.data[0].url
      const modelName = data.model || params?.model || 'dall-e'

      console.log('Got image URL:', imageUrl)
      console.log('Using model:', modelName)

      try {
        // Fetch the image using the proxy-image endpoint instead of direct fetch
        console.log('Fetching image from URL via proxy...')
        const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`

        const imageResponse = await fetch(proxyUrl, {
          headers: {
            Accept: 'image/*, */*',
          },
          cache: 'no-store', // Don't use cache
        })

        if (!imageResponse.ok) {
          console.error('Failed to fetch image:', imageResponse.status, imageResponse.statusText)
          throw new Error(`Failed to fetch image: ${imageResponse.statusText}`)
        }

        console.log(
          'Image fetch successful, content-type:',
          imageResponse.headers.get('content-type')
        )

        const imageBlob = await imageResponse.blob()
        console.log('Image blob size:', imageBlob.size)

        if (imageBlob.size === 0) {
          console.error('Empty image blob received')
          throw new Error('Empty image received')
        }

        const reader = new FileReader()
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onloadend = () => {
            try {
              const base64data = reader.result as string
              if (!base64data) {
                reject(new Error('No data read from image'))
                return
              }

              const base64Content = base64data.split(',')[1] // Remove the data URL prefix
              console.log('Successfully converted image to base64, length:', base64Content.length)
              resolve(base64Content)
            } catch (err) {
              console.error('Error in FileReader onloadend:', err)
              reject(err)
            }
          }
          reader.onerror = (err) => {
            console.error('FileReader error:', err)
            reject(new Error('Failed to read image data'))
          }
          reader.readAsDataURL(imageBlob)
        })

        const base64Image = await base64Promise

        console.log('Returning success response with image data')
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
        console.error('Error fetching or processing image:', error)

        // Try again with a direct browser fetch as fallback
        try {
          console.log('Attempting fallback with direct browser fetch...')
          const directImageResponse = await fetch(imageUrl, {
            cache: 'no-store',
            headers: {
              Accept: 'image/*, */*',
              'User-Agent': 'Mozilla/5.0 (compatible; DalleProxy/1.0)',
            },
          })

          if (!directImageResponse.ok) {
            throw new Error(`Direct fetch failed: ${directImageResponse.status}`)
          }

          const imageBlob = await directImageResponse.blob()
          if (imageBlob.size === 0) {
            throw new Error('Empty blob received from direct fetch')
          }

          const reader = new FileReader()
          const base64Promise = new Promise<string>((resolve, reject) => {
            reader.onloadend = () => {
              try {
                const base64data = reader.result as string
                if (!base64data) {
                  reject(new Error('No data read from image'))
                  return
                }

                const base64Content = base64data.split(',')[1]
                console.log(
                  'Successfully converted image to base64 via direct fetch, length:',
                  base64Content.length
                )
                resolve(base64Content)
              } catch (err) {
                reject(err)
              }
            }
            reader.onerror = reject
            reader.readAsDataURL(imageBlob)
          })

          const base64Image = await base64Promise

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
          console.error('Fallback fetch also failed:', fallbackError)

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
      console.error('Error in DALL-E response handling:', error)
      throw error
    }
  },
  transformError: (error) => {
    console.error('DALL-E error:', error)
    if (error.response?.data?.error?.message) {
      return error.response.data.error.message
    }
    return error.message || 'Failed to generate image with DALL-E'
  },
}
