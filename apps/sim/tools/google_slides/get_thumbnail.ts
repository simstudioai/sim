import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesGetThumbnailTool')

interface GetThumbnailParams {
  accessToken: string
  presentationId: string
  pageObjectId: string
  thumbnailSize?: string
  mimeType?: string
}

interface GetThumbnailResponse {
  success: boolean
  output: {
    contentUrl: string
    width: number
    height: number
    metadata: {
      presentationId: string
      pageObjectId: string
      thumbnailSize: string
      mimeType: string
    }
  }
}

// Available thumbnail sizes
const THUMBNAIL_SIZES = ['SMALL', 'MEDIUM', 'LARGE'] as const

// Available MIME types for thumbnails
const MIME_TYPES = ['PNG', 'GIF'] as const

export const getThumbnailTool: ToolConfig<GetThumbnailParams, GetThumbnailResponse> = {
  id: 'google_slides_get_thumbnail',
  name: 'Get Slide Thumbnail',
  description: 'Generate a thumbnail image of a specific slide in a Google Slides presentation',
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
      description: 'The object ID of the slide/page to get a thumbnail for',
    },
    thumbnailSize: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The size of the thumbnail: SMALL (200px), MEDIUM (800px), or LARGE (1600px). Defaults to MEDIUM.',
    },
    mimeType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The MIME type of the thumbnail image: PNG or GIF. Defaults to PNG.',
    },
  },

  request: {
    url: (params) => {
      const presentationId = params.presentationId?.trim()
      const pageObjectId = params.pageObjectId?.trim()

      if (!presentationId) {
        throw new Error('Presentation ID is required')
      }
      if (!pageObjectId) {
        throw new Error('Page Object ID is required')
      }

      // Build the URL with query parameters for thumbnail properties
      let size = (params.thumbnailSize || 'MEDIUM').toUpperCase()
      if (!THUMBNAIL_SIZES.includes(size as (typeof THUMBNAIL_SIZES)[number])) {
        size = 'MEDIUM'
      }

      // Validate and normalize mimeType
      let mimeType = (params.mimeType || 'PNG').toUpperCase()
      if (!MIME_TYPES.includes(mimeType as (typeof MIME_TYPES)[number])) {
        mimeType = 'PNG'
      }

      // The API uses thumbnailProperties as query parameters
      let url = `https://slides.googleapis.com/v1/presentations/${presentationId}/pages/${pageObjectId}/thumbnail?thumbnailProperties.thumbnailSize=${size}`

      // Add mimeType if not the default (PNG)
      if (mimeType !== 'PNG') {
        url += `&thumbnailProperties.mimeType=${mimeType}`
      }

      return url
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to get thumbnail')
    }

    const presentationId = params?.presentationId?.trim() || ''
    const pageObjectId = params?.pageObjectId?.trim() || ''
    const thumbnailSize = (params?.thumbnailSize || 'MEDIUM').toUpperCase()
    const mimeType = (params?.mimeType || 'PNG').toUpperCase()

    return {
      success: true,
      output: {
        contentUrl: data.contentUrl,
        width: data.width,
        height: data.height,
        metadata: {
          presentationId,
          pageObjectId,
          thumbnailSize,
          mimeType,
        },
      },
    }
  },

  outputs: {
    contentUrl: {
      type: 'string',
      description: 'URL to the thumbnail image (valid for 30 minutes)',
    },
    width: {
      type: 'number',
      description: 'Width of the thumbnail in pixels',
    },
    height: {
      type: 'number',
      description: 'Height of the thumbnail in pixels',
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata including presentation ID and page object ID',
      properties: {
        presentationId: {
          type: 'string',
          description: 'The presentation ID',
        },
        pageObjectId: {
          type: 'string',
          description: 'The page object ID for the thumbnail',
        },
        thumbnailSize: {
          type: 'string',
          description: 'The requested thumbnail size',
        },
        mimeType: {
          type: 'string',
          description: 'The thumbnail MIME type',
        },
      },
    },
  },
}
