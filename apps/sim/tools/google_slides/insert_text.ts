import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesInsertTextTool')

interface InsertTextParams {
  accessToken: string
  presentationId: string
  objectId: string
  text: string
  insertionIndex?: number
}

interface InsertTextResponse {
  success: boolean
  output: {
    inserted: boolean
    objectId: string
    text: string
    metadata: {
      presentationId: string
      url: string
    }
  }
}

export const insertTextTool: ToolConfig<InsertTextParams, InsertTextResponse> = {
  id: 'google_slides_insert_text',
  name: 'Insert Text in Google Slides',
  description:
    'Insert text into a shape or table cell in a Google Slides presentation. Use this to add text to text boxes, shapes, or table cells.',
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
    objectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The object ID of the shape or table cell to insert text into. For table cells, use the cell object ID.',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text to insert',
    },
    insertionIndex: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The zero-based index at which to insert the text. If not specified, text is inserted at the beginning (index 0).',
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
      const objectId = params.objectId?.trim()
      if (!objectId) {
        throw new Error('Object ID is required')
      }

      if (params.text === undefined || params.text === null) {
        throw new Error('Text is required')
      }

      return {
        requests: [
          {
            insertText: {
              objectId,
              text: params.text,
              insertionIndex: params.insertionIndex ?? 0,
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
      throw new Error(data.error?.message || 'Failed to insert text')
    }

    const presentationId = params?.presentationId?.trim() || ''
    const objectId = params?.objectId?.trim() || ''

    return {
      success: true,
      output: {
        inserted: true,
        objectId,
        text: params?.text ?? '',
        metadata: {
          presentationId,
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
        },
      },
    }
  },

  outputs: {
    inserted: {
      type: 'boolean',
      description: 'Whether the text was successfully inserted',
    },
    objectId: {
      type: 'string',
      description: 'The object ID where text was inserted',
    },
    text: {
      type: 'string',
      description: 'The text that was inserted',
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
