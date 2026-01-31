import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesAddImageTool')

interface AddImageParams {
  accessToken: string
  presentationId: string
  pageObjectId: string
  imageUrl: string
  width?: number
  height?: number
  positionX?: number
  positionY?: number
}

interface AddImageResponse {
  success: boolean
  output: {
    imageId: string
    metadata: {
      presentationId: string
      pageObjectId: string
      imageUrl: string
      url: string
    }
  }
}

// EMU (English Metric Units) conversion: 1 inch = 914400 EMU, 1 pt = 12700 EMU
const PT_TO_EMU = 12700

export const addImageTool: ToolConfig<AddImageParams, AddImageResponse> = {
  id: 'google_slides_add_image',
  name: 'Add Image to Google Slides',
  description: 'Insert an image into a specific slide in a Google Slides presentation',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-drive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Slides API',
    },
    presentationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Slides presentation ID',
    },
    pageObjectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The object ID of the slide/page to add the image to',
    },
    imageUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The publicly accessible URL of the image (must be PNG, JPEG, or GIF, max 50MB)',
    },
    width: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Width of the image in points (default: 300)',
    },
    height: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Height of the image in points (default: 200)',
    },
    positionX: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'X position from the left edge in points (default: 100)',
    },
    positionY: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Y position from the top edge in points (default: 100)',
    },
  },

  request: {
    url: (params) => {
      const presentationId = params.presentationId?.trim()
      if (!presentationId) {
        throw new Error('Presentation ID is required')
      }
      return `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const pageObjectId = params.pageObjectId?.trim()
      const imageUrl = params.imageUrl?.trim()

      if (!pageObjectId) {
        throw new Error('Page Object ID is required')
      }
      if (!imageUrl) {
        throw new Error('Image URL is required')
      }

      // Generate a unique object ID for the new image
      const imageObjectId = `image_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

      // Convert points to EMU (default sizes if not specified)
      const widthEmu = (params.width || 300) * PT_TO_EMU
      const heightEmu = (params.height || 200) * PT_TO_EMU
      const translateX = (params.positionX || 100) * PT_TO_EMU
      const translateY = (params.positionY || 100) * PT_TO_EMU

      return {
        requests: [
          {
            createImage: {
              objectId: imageObjectId,
              url: imageUrl,
              elementProperties: {
                pageObjectId: pageObjectId,
                size: {
                  width: {
                    magnitude: widthEmu,
                    unit: 'EMU',
                  },
                  height: {
                    magnitude: heightEmu,
                    unit: 'EMU',
                  },
                },
                transform: {
                  scaleX: 1,
                  scaleY: 1,
                  translateX: translateX,
                  translateY: translateY,
                  unit: 'EMU',
                },
              },
            },
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to add image')
    }

    // The response contains the created image's object ID
    const createImageReply = data.replies?.[0]?.createImage
    const imageId = createImageReply?.objectId || ''

    const presentationId = params?.presentationId?.trim() || ''
    const pageObjectId = params?.pageObjectId?.trim() || ''

    return {
      success: true,
      output: {
        imageId,
        metadata: {
          presentationId,
          pageObjectId,
          imageUrl: params?.imageUrl?.trim() || '',
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
        },
      },
    }
  },

  outputs: {
    imageId: {
      type: 'string',
      description: 'The object ID of the newly created image',
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata including presentation ID and image URL',
      properties: {
        presentationId: {
          type: 'string',
          description: 'The presentation ID',
        },
        pageObjectId: {
          type: 'string',
          description: 'The page object ID where the image was inserted',
        },
        imageUrl: {
          type: 'string',
          description: 'The source image URL',
        },
        url: {
          type: 'string',
          description: 'URL to open the presentation',
        },
      },
    },
  },
}
