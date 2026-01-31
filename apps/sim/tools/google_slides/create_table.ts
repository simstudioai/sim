import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesCreateTableTool')

interface CreateTableParams {
  accessToken: string
  presentationId: string
  pageObjectId: string
  rows: number
  columns: number
  width?: number
  height?: number
  positionX?: number
  positionY?: number
}

interface CreateTableResponse {
  success: boolean
  output: {
    tableId: string
    rows: number
    columns: number
    metadata: {
      presentationId: string
      pageObjectId: string
      url: string
    }
  }
}

// EMU (English Metric Units) conversion: 1 pt = 12700 EMU
const PT_TO_EMU = 12700

export const createTableTool: ToolConfig<CreateTableParams, CreateTableResponse> = {
  id: 'google_slides_create_table',
  name: 'Create Table in Google Slides',
  description: 'Create a new table on a slide in a Google Slides presentation',
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
      description: 'The object ID of the slide/page to add the table to',
    },
    rows: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of rows in the table (minimum 1)',
    },
    columns: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of columns in the table (minimum 1)',
    },
    width: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Width of the table in points (default: 400)',
    },
    height: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Height of the table in points (default: 200)',
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
      if (!pageObjectId) {
        throw new Error('Page Object ID is required')
      }

      const rows = params.rows
      const columns = params.columns

      if (!rows || rows < 1) {
        throw new Error('Rows must be at least 1')
      }
      if (!columns || columns < 1) {
        throw new Error('Columns must be at least 1')
      }

      // Generate a unique object ID for the new table
      const tableObjectId = `table_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

      // Convert points to EMU
      const widthEmu = (params.width || 400) * PT_TO_EMU
      const heightEmu = (params.height || 200) * PT_TO_EMU
      const translateX = (params.positionX || 100) * PT_TO_EMU
      const translateY = (params.positionY || 100) * PT_TO_EMU

      return {
        requests: [
          {
            createTable: {
              objectId: tableObjectId,
              rows,
              columns,
              elementProperties: {
                pageObjectId,
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
                  translateX,
                  translateY,
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
      throw new Error(data.error?.message || 'Failed to create table')
    }

    const createTableReply = data.replies?.[0]?.createTable
    const tableId = createTableReply?.objectId || ''

    const presentationId = params?.presentationId?.trim() || ''
    const pageObjectId = params?.pageObjectId?.trim() || ''

    return {
      success: true,
      output: {
        tableId,
        rows: params?.rows ?? 0,
        columns: params?.columns ?? 0,
        metadata: {
          presentationId,
          pageObjectId,
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
        },
      },
    }
  },

  outputs: {
    tableId: {
      type: 'string',
      description: 'The object ID of the newly created table',
    },
    rows: {
      type: 'number',
      description: 'Number of rows in the table',
    },
    columns: {
      type: 'number',
      description: 'Number of columns in the table',
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata including presentation ID and page object ID',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        pageObjectId: {
          type: 'string',
          description: 'The page object ID where the table was created',
        },
        url: { type: 'string', description: 'URL to the presentation' },
      },
    },
  },
}
