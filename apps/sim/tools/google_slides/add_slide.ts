import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesAddSlideTool')

interface AddSlideParams {
  accessToken: string
  presentationId: string
  layout?: string
  insertionIndex?: number
  placeholderIdMappings?: string
}

interface AddSlideResponse {
  success: boolean
  output: {
    slideId: string
    metadata: {
      presentationId: string
      layout: string
      insertionIndex?: number
      url: string
    }
  }
}

// Predefined layouts available in Google Slides API
const PREDEFINED_LAYOUTS = [
  'BLANK',
  'CAPTION_ONLY',
  'TITLE',
  'TITLE_AND_BODY',
  'TITLE_AND_TWO_COLUMNS',
  'TITLE_ONLY',
  'SECTION_HEADER',
  'SECTION_TITLE_AND_DESCRIPTION',
  'ONE_COLUMN_TEXT',
  'MAIN_POINT',
  'BIG_NUMBER',
] as const

export const addSlideTool: ToolConfig<AddSlideParams, AddSlideResponse> = {
  id: 'google_slides_add_slide',
  name: 'Add Slide to Google Slides',
  description: 'Add a new slide to a Google Slides presentation with a specified layout',
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
    layout: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The predefined layout for the slide (BLANK, TITLE, TITLE_AND_BODY, TITLE_ONLY, SECTION_HEADER, etc.). Defaults to BLANK.',
    },
    insertionIndex: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The optional zero-based index indicating where to insert the slide. If not specified, the slide is added at the end.',
    },
    placeholderIdMappings: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of placeholder mappings to assign custom object IDs to placeholders. Format: [{"layoutPlaceholder":{"type":"TITLE"},"objectId":"custom_title_id"}]',
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
      // Generate a unique object ID for the new slide
      const slideObjectId = `slide_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

      // Validate and normalize the layout
      let layout = (params.layout || 'BLANK').toUpperCase()
      if (!PREDEFINED_LAYOUTS.includes(layout as (typeof PREDEFINED_LAYOUTS)[number])) {
        logger.warn(`Invalid layout "${params.layout}", defaulting to BLANK`)
        layout = 'BLANK'
      }

      const createSlideRequest: Record<string, any> = {
        objectId: slideObjectId,
        slideLayoutReference: {
          predefinedLayout: layout,
        },
      }

      // Add insertion index if specified
      if (params.insertionIndex !== undefined && params.insertionIndex >= 0) {
        createSlideRequest.insertionIndex = params.insertionIndex
      }

      // Add placeholder ID mappings if specified (for advanced use cases)
      if (params.placeholderIdMappings?.trim()) {
        try {
          const mappings = JSON.parse(params.placeholderIdMappings)
          if (Array.isArray(mappings) && mappings.length > 0) {
            createSlideRequest.placeholderIdMappings = mappings
          }
        } catch (e) {
          logger.warn('Invalid placeholderIdMappings JSON, ignoring:', e)
        }
      }

      return {
        requests: [
          {
            createSlide: createSlideRequest,
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to add slide')
    }

    // The response contains the created slide's object ID
    const createSlideReply = data.replies?.[0]?.createSlide
    const slideId = createSlideReply?.objectId || ''

    const presentationId = params?.presentationId?.trim() || ''
    const layout = (params?.layout || 'BLANK').toUpperCase()

    return {
      success: true,
      output: {
        slideId,
        metadata: {
          presentationId,
          layout,
          insertionIndex: params?.insertionIndex,
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
        },
      },
    }
  },

  outputs: {
    slideId: {
      type: 'string',
      description: 'The object ID of the newly created slide',
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata including presentation ID, layout, and URL',
      properties: {
        presentationId: {
          type: 'string',
          description: 'The presentation ID',
        },
        layout: {
          type: 'string',
          description: 'The layout used for the new slide',
        },
        insertionIndex: {
          type: 'number',
          description: 'The zero-based index where the slide was inserted',
          optional: true,
        },
        url: {
          type: 'string',
          description: 'URL to open the presentation',
        },
      },
    },
  },
}
