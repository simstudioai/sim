import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesReplaceAllShapesWithImageTool')

interface ReplaceAllShapesWithImageParams {
  accessToken: string
  presentationId: string
  imageUrl: string
  findText: string
  matchCase?: boolean
  imageReplaceMethod?: 'CENTER_INSIDE' | 'CENTER_CROP'
  pageObjectIds?: string
}

interface ReplaceAllShapesWithImageResponse {
  success: boolean
  output: {
    occurrencesChanged: number
    metadata: { presentationId: string; url: string; imageUrl: string; findText: string }
  }
}

export const replaceAllShapesWithImageTool: ToolConfig<
  ReplaceAllShapesWithImageParams,
  ReplaceAllShapesWithImageResponse
> = {
  id: 'google_slides_replace_all_shapes_with_image',
  name: 'Replace All Shapes With Image in Google Slides',
  description:
    "Find every shape whose text matches the given token (e.g. {{cover-image}}) and replace it with an image, preserving the shape's position and bounds.",
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
    imageUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "Publicly fetchable image URL (PNG, JPEG, or GIF; max 50 MB and accessible to Google's servers)",
    },
    findText: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text content of shapes to replace (e.g. {{cover-image}})',
    },
    matchCase: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Case-sensitive match (default: true)',
    },
    imageReplaceMethod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How the image fits the shape: CENTER_INSIDE (preserve aspect, fit inside) or CENTER_CROP (fill, crop overflow). Default: CENTER_INSIDE.',
    },
    pageObjectIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated slide IDs to limit replacement to specific slides',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const imageUrl = params.imageUrl?.trim()
      const findText = params.findText
      if (!imageUrl) throw new Error('Image URL is required')
      if (!findText) throw new Error('Find text is required')

      const request: Record<string, unknown> = {
        imageUrl,
        containsText: {
          text: findText,
          matchCase: params.matchCase !== false,
        },
        imageReplaceMethod: params.imageReplaceMethod || 'CENTER_INSIDE',
      }
      if (params.pageObjectIds?.trim()) {
        request.pageObjectIds = params.pageObjectIds
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      }

      return { requests: [{ replaceAllShapesWithImage: request }] }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to replace shapes with image')
    }
    const occurrencesChanged = data.replies?.[0]?.replaceAllShapesWithImage?.occurrencesChanged ?? 0
    const presentationId = params?.presentationId?.trim() || ''
    return {
      success: true,
      output: {
        occurrencesChanged,
        metadata: {
          presentationId,
          url: presentationUrl(presentationId),
          imageUrl: params?.imageUrl?.trim() || '',
          findText: params?.findText || '',
        },
      },
    }
  },

  outputs: {
    occurrencesChanged: {
      type: 'number',
      description: 'Number of shapes that were replaced with the image',
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        url: { type: 'string', description: 'URL to the presentation' },
        imageUrl: { type: 'string', description: 'The image URL inserted' },
        findText: { type: 'string', description: 'The matched text token' },
      },
    },
  },
}
