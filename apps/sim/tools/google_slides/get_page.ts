import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesGetPageTool')

interface GetPageParams {
  accessToken: string
  presentationId: string
  pageObjectId: string
}

interface GetPageResponse {
  success: boolean
  output: {
    objectId: string
    pageType: string
    pageElements: any[]
    slideProperties: {
      layoutObjectId: string | null
      masterObjectId: string | null
      notesPage: any | null
    } | null
    metadata: {
      presentationId: string
      url: string
    }
  }
}

export const getPageTool: ToolConfig<GetPageParams, GetPageResponse> = {
  id: 'google_slides_get_page',
  name: 'Get Slide Page',
  description:
    'Get detailed information about a specific slide/page in a Google Slides presentation',
  version: '1.0.0',

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
      description: 'The object ID of the slide/page to retrieve',
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

      return `https://slides.googleapis.com/v1/presentations/${presentationId}/pages/${pageObjectId}`
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
      throw new Error(data.error?.message || 'Failed to get page')
    }

    const presentationId = params?.presentationId?.trim() || ''

    return {
      success: true,
      output: {
        objectId: data.objectId,
        pageType: data.pageType ?? 'SLIDE',
        pageElements: data.pageElements ?? [],
        slideProperties: data.slideProperties
          ? {
              layoutObjectId: data.slideProperties.layoutObjectId ?? null,
              masterObjectId: data.slideProperties.masterObjectId ?? null,
              notesPage: data.slideProperties.notesPage ?? null,
            }
          : null,
        metadata: {
          presentationId,
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
        },
      },
    }
  },

  outputs: {
    objectId: {
      type: 'string',
      description: 'The object ID of the page',
    },
    pageType: {
      type: 'string',
      description: 'The type of page (SLIDE, MASTER, LAYOUT, NOTES, NOTES_MASTER)',
    },
    pageElements: {
      type: 'array',
      description: 'Array of page elements (shapes, images, tables, etc.) on this page',
      items: {
        type: 'json',
      },
    },
    slideProperties: {
      type: 'object',
      description: 'Properties specific to slides (layout, master, notes)',
      optional: true,
      properties: {
        layoutObjectId: {
          type: 'string',
          description: 'Object ID of the layout this slide is based on',
        },
        masterObjectId: {
          type: 'string',
          description: 'Object ID of the master this slide is based on',
        },
        notesPage: {
          type: 'json',
          description: 'The notes page associated with the slide',
          optional: true,
        },
      },
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata including presentation ID and URL',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        url: { type: 'string', description: 'URL to the presentation' },
      },
    },
  },
}
