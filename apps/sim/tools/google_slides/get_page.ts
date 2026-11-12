import { createLogger } from '@sim/logger'
import {
  extractPageText,
  extractSpeakerNotes,
  slidesPresentationUrl,
} from '@/tools/google_slides/utils'
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
      isSkipped: boolean
    } | null
    revisionId?: string | null
    pageProperties?: Record<string, unknown> | null
    layoutProperties?: Record<string, unknown> | null
    notesProperties?: Record<string, unknown> | null
    masterProperties?: Record<string, unknown> | null
    pageText?: string
    speakerNotes?: string
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
      return slidesPresentationUrl(params.presentationId, params.pageObjectId ?? '')
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
              isSkipped: data.slideProperties.isSkipped ?? false,
            }
          : null,
        revisionId: data.revisionId ?? null,
        pageProperties: data.pageProperties ?? null,
        layoutProperties: data.layoutProperties ?? null,
        notesProperties: data.notesProperties ?? null,
        masterProperties: data.masterProperties ?? null,
        pageText: extractPageText(data),
        speakerNotes: extractSpeakerNotes(data),
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
        isSkipped: {
          type: 'boolean',
          description: 'Whether the slide is skipped in presentation mode',
          optional: true,
        },
      },
    },
    revisionId: {
      type: 'string',
      description:
        'Revision ID of the presentation; pass as requiredRevisionId in a batch update writeControl',
      optional: true,
      nullable: true,
    },
    pageProperties: {
      type: 'json',
      description: 'Page properties (background fill, color scheme)',
      optional: true,
      nullable: true,
    },
    layoutProperties: {
      type: 'json',
      description:
        'Layout properties (masterObjectId, name, displayName); set only for LAYOUT pages',
      optional: true,
      nullable: true,
    },
    notesProperties: {
      type: 'json',
      description: 'Notes properties (speakerNotesObjectId); set only for NOTES pages',
      optional: true,
      nullable: true,
    },
    masterProperties: {
      type: 'json',
      description: 'Master properties (displayName); set only for MASTER pages',
      optional: true,
      nullable: true,
    },
    pageText: {
      type: 'string',
      description: 'Text from the page shapes, tables, and groups, one block per line',
      optional: true,
    },
    speakerNotes: {
      type: 'string',
      description: 'Speaker notes text of the slide (empty if none)',
      optional: true,
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
