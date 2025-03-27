import { ToolConfig, ToolResponse } from '../types'

export interface DalleResponse extends ToolResponse {
  output: {
    url: string
    revised_prompt?: string
    prompt: string
    model: string
    image: string
  }
}

export const dalleTool: ToolConfig = {
  id: 'dalle_generate',
  name: 'DALL-E Generate',
  description: 'Generate images using OpenAI\'s DALL-E model',
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
  transformResponse: async (response) => {
    const data = await response.json()
    
    if (!data.data?.[0]?.url) {
      throw new Error('No image URL in response')
    }

    const imageUrl = data.data[0].url
    
    try {
      // Fetch the image and convert to base64
      const imageResponse = await fetch(imageUrl)
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.statusText}`)
      }
      
      const imageBlob = await imageResponse.blob()
      const reader = new FileReader()
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const base64data = reader.result as string
          resolve(base64data.split(',')[1]) // Remove the data URL prefix
        }
        reader.onerror = () => reject(new Error('Failed to read image data'))
        reader.readAsDataURL(imageBlob)
      })
      const base64Image = await base64Promise

      return {
        success: true,
        output: {
          url: imageUrl,
          prompt: data.prompt,
          revised_prompt: data.data[0].revised_prompt,
          model: data.model,
          image: base64Image,
        },
      }
    } catch (error) {
      // If we can't fetch the image, still return the URL but without the base64 data
      return {
        success: true,
        output: {
          url: imageUrl,
          prompt: data.prompt,
          revised_prompt: data.data[0].revised_prompt,
          model: data.model,
          image: null,
        },
      }
    }
  },
  transformError: (error) => {
    if (error.response?.data?.error?.message) {
      return error.response.data.error.message
    }
    return error.message || 'Failed to generate image with DALL-E'
  },
} 