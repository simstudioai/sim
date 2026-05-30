import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesMergeTableCellsTool')

interface MergeTableCellsParams {
  accessToken: string
  presentationId: string
  objectId: string
  rowIndex: number
  columnIndex: number
  rowSpan: number
  columnSpan: number
}

interface MergeTableCellsResponse {
  success: boolean
  output: {
    merged: boolean
    objectId: string
    metadata: { presentationId: string; url: string }
  }
}

export const mergeTableCellsTool: ToolConfig<MergeTableCellsParams, MergeTableCellsResponse> = {
  id: 'google_slides_merge_table_cells',
  name: 'Merge Table Cells in Google Slides',
  description:
    'Merge a rectangular range of table cells into a single cell. The range starts at (rowIndex, columnIndex) and covers rowSpan × columnSpan cells.',
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
      description: 'Zero-based row index of the top-left cell',
    },
    columnIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Zero-based column index of the top-left cell',
    },
    rowSpan: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of rows to merge (minimum 1)',
    },
    columnSpan: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of columns to merge (minimum 1)',
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
            mergeTableCells: {
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
      throw new Error(data.error?.message || 'Failed to merge table cells')
    }
    const presentationId = params?.presentationId?.trim() || ''
    return {
      success: true,
      output: {
        merged: true,
        objectId: params?.objectId?.trim() || '',
        metadata: { presentationId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    merged: { type: 'boolean', description: 'Whether the cells were merged' },
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
