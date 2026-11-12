import type { GoogleSlidesReadResponse, GoogleSlidesToolParams } from '@/tools/google_slides/types'
import {
  extractPageText,
  extractSpeakerNotes,
  type SlidesPage,
  slidesPresentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

export const readTool: ToolConfig<GoogleSlidesToolParams, GoogleSlidesReadResponse> = {
  id: 'google_slides_read',
  name: 'Read Google Slides Presentation',
  description: 'Read content from a Google Slides presentation',
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
  },

  request: {
    url: (params) => {
      const presentationId = params.presentationId?.trim() || params.manualPresentationId?.trim()
      return slidesPresentationUrl(presentationId)
    },
    method: 'GET',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // Extract slides from the response
    const slides = data.slides || []
    const slideContents = (Array.isArray(slides) ? (slides as SlidesPage[]) : []).map(
      (slide, index) => ({
        objectId: slide.objectId ?? null,
        index,
        text: extractPageText(slide),
        speakerNotes: extractSpeakerNotes(slide),
        isSkipped: slide.slideProperties?.isSkipped ?? false,
      })
    )

    // Create presentation metadata
    const metadata = {
      presentationId: data.presentationId,
      title: data.title || 'Untitled Presentation',
      pageSize: data.pageSize,
      mimeType: 'application/vnd.google-apps.presentation',
      url: `https://docs.google.com/presentation/d/${data.presentationId}/edit`,
      revisionId: data.revisionId ?? null,
      locale: data.locale ?? null,
    }

    return {
      success: true,
      output: {
        slides,
        slideContents,
        metadata,
      },
    }
  },

  outputs: {
    slides: { type: 'json', description: 'Array of slides with their content' },
    slideContents: {
      type: 'array',
      description: 'Plain-text view of each slide in order, including speaker notes',
      optional: true,
      items: {
        type: 'object',
        properties: {
          objectId: { type: 'string', description: 'Slide object ID' },
          index: { type: 'number', description: 'Zero-based slide position' },
          text: {
            type: 'string',
            description: 'Text from the slide shapes, tables, and groups, one block per line',
          },
          speakerNotes: { type: 'string', description: 'Speaker notes text (empty if none)' },
          isSkipped: {
            type: 'boolean',
            description: 'Whether the slide is skipped in presentation mode',
          },
        },
      },
    },
    metadata: {
      type: 'json',
      description: 'Presentation metadata including ID, title, and URL',
      properties: {
        presentationId: {
          type: 'string',
          description: 'The presentation ID',
        },
        title: {
          type: 'string',
          description: 'The presentation title',
        },
        pageSize: {
          type: 'object',
          description: 'Presentation page size',
          optional: true,
          properties: {
            width: {
              type: 'json',
              description: 'Page width as a Dimension object',
            },
            height: {
              type: 'json',
              description: 'Page height as a Dimension object',
            },
          },
        },
        mimeType: {
          type: 'string',
          description: 'The mime type of the presentation',
        },
        url: {
          type: 'string',
          description: 'URL to open the presentation',
        },
        revisionId: {
          type: 'string',
          description:
            'Revision ID of the presentation (only for users with edit access); pass as requiredRevisionId in a batch update writeControl',
          optional: true,
          nullable: true,
        },
        locale: {
          type: 'string',
          description: 'Presentation locale as an IETF BCP 47 language tag',
          optional: true,
          nullable: true,
        },
      },
    },
  },
}
