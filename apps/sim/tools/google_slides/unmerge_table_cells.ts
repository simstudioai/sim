import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUnmergeTableCellsTool')

interface UnmergeTableCellsParams {
  accessToken: string
  presentationId: string
  objectId: string
  rowIndex: number
  columnIndex: number
  rowSpan: number
  columnSpan: number
}

interface UnmergeTableCellsResponse {
  success: boolean
  output: {
    unmerged: boolean
    objectId: string
    metadata: { presentationId: string; url: string }
  }
}

export const unmergeTableCellsTool: ToolConfig<UnmergeTableCellsParams, UnmergeTableCellsResponse> =
  {
    id: 'google_slides_unmerge_table_cells',
    name: 'Unmerge Table Cells in Google Slides',
    description: 'Unmerge any merged cells within the given table range.',
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
      objectId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Object ID of the table',
      },
      rowIndex: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'Zero-based row index of the top-left cell of the range',
      },
      columnIndex: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'Zero-based column index of the top-left cell of the range',
      },
      rowSpan: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'Number of rows in the range (minimum 1)',
      },
      columnSpan: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'Number of columns in the range (minimum 1)',
      },
    },

    request: {
      url: (params) => batchUpdateUrl(params.presentationId),
      method: 'POST',
      headers: (params) => authJsonHeaders(params.accessToken),
      body: (params) => {
        const objectId = params.objectId?.trim()
        if (!objectId) throw new Error('Table object ID is required')
        if (!params.rowSpan || params.rowSpan < 1) throw new Error('rowSpan must be at least 1')
        if (!params.columnSpan || params.columnSpan < 1)
          throw new Error('columnSpan must be at least 1')

        return {
          requests: [
            {
              unmergeTableCells: {
                objectId,
                tableRange: {
                  location: { rowIndex: params.rowIndex, columnIndex: params.columnIndex },
                  rowSpan: params.rowSpan,
                  columnSpan: params.columnSpan,
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
        throw new Error(data.error?.message || 'Failed to unmerge table cells')
      }
      const presentationId = params?.presentationId?.trim() || ''
      return {
        success: true,
        output: {
          unmerged: true,
          objectId: params?.objectId?.trim() || '',
          metadata: { presentationId, url: presentationUrl(presentationId) },
        },
      }
    },

    outputs: {
      unmerged: { type: 'boolean', description: 'Whether the cells were unmerged' },
      objectId: { type: 'string', description: 'The table updated' },
      metadata: {
        type: 'object',
        description: 'Operation metadata',
        properties: {
          presentationId: { type: 'string', description: 'The presentation ID' },
          url: { type: 'string', description: 'URL to the presentation' },
        },
      },
    },
  }
