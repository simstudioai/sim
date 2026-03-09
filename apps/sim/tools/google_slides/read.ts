import type { GoogleSlidesReadResponse, GoogleSlidesToolParams } from '@/tools/google_slides/types'
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
      // Ensure presentationId is valid
      const presentationId = params.presentationId?.trim() || params.manualPresentationId?.trim()
      if (!presentationId) {
        throw new Error('Presentation ID is required')
      }

      return `https://slides.googleapis.com/v1/presentations/${presentationId}`
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

    // Create presentation metadata
    const metadata = {
      presentationId: data.presentationId,
      title: data.title || 'Untitled Presentation',
      pageSize: data.pageSize,
      mimeType: 'application/vnd.google-apps.presentation',
      url: `https://docs.google.com/presentation/d/${data.presentationId}/edit`,
    }

    return {
      success: true,
      output: {
        slides,
        metadata,
      },
    }
  },

  outputs: {
    slides: { type: 'json', description: 'Array of slides with their content' },
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
      },
    },
  },
}
