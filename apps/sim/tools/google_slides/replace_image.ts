import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesReplaceImageTool')

interface ReplaceImageParams {
  accessToken: string
  presentationId: string
  imageObjectId: string
  imageUrl: string
  imageReplaceMethod?: 'CENTER_INSIDE' | 'CENTER_CROP'
}

interface ReplaceImageResponse {
  success: boolean
  output: {
    replaced: boolean
    imageObjectId: string
    metadata: { presentationId: string; url: string; imageUrl: string }
  }
}

export const replaceImageTool: ToolConfig<ReplaceImageParams, ReplaceImageResponse> = {
  id: 'google_slides_replace_image',
  name: 'Replace Image in Google Slides',
  description:
    "Replace the source of an existing image with a new image URL, preserving the image's position, size, and properties.",
  version: '1.0.0',

  oauth: { required: true, provider: 'google-drive' },

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
    imageObjectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object ID of the existing image to replace',
    },
    imageUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New publicly fetchable image URL (PNG, JPEG, or GIF, max 50 MB)',
    },
    imageReplaceMethod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'CENTER_INSIDE (preserve aspect) or CENTER_CROP (fill, crop overflow). Default: CENTER_INSIDE.',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const imageObjectId = params.imageObjectId?.trim()
      const imageUrl = params.imageUrl?.trim()
      if (!imageObjectId) throw new Error('Image object ID is required')
      if (!imageUrl) throw new Error('Image URL is required')

      return {
        requests: [
          {
            replaceImage: {
              imageObjectId,
              url: imageUrl,
              imageReplaceMethod: params.imageReplaceMethod || 'CENTER_INSIDE',
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
      throw new Error(data.error?.message || 'Failed to replace image')
    }
    const presentationId = params?.presentationId?.trim() || ''
    return {
      success: true,
      output: {
        replaced: true,
        imageObjectId: params?.imageObjectId?.trim() || '',
        metadata: {
          presentationId,
          url: presentationUrl(presentationId),
          imageUrl: params?.imageUrl?.trim() || '',
        },
      },
    }
  },

  outputs: {
    replaced: { type: 'boolean', description: 'Whether the image was replaced' },
    imageObjectId: { type: 'string', description: 'The image object that was replaced' },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        url: { type: 'string', description: 'URL to the presentation' },
        imageUrl: { type: 'string', description: 'The new image URL' },
      },
    },
  },
}
