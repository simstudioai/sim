import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  buildCellLocation,
  buildTextRange,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesDeleteTextTool')

interface DeleteTextParams {
  accessToken: string
  presentationId: string
  objectId: string
  rowIndex?: number
  columnIndex?: number
  rangeType?: 'ALL' | 'FROM_START_INDEX' | 'FIXED_RANGE'
  startIndex?: number
  endIndex?: number
}

interface DeleteTextResponse {
  success: boolean
  output: {
    deleted: boolean
    objectId: string
    metadata: { presentationId: string; url: string }
  }
}

export const deleteTextTool: ToolConfig<DeleteTextParams, DeleteTextResponse> = {
  id: 'google_slides_delete_text',
  name: 'Delete Text in Google Slides',
  description:
    'Delete text from a shape or table cell. Use range type ALL to clear all text, or FIXED_RANGE / FROM_START_INDEX to delete a specific span.',
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
      description: 'Object ID of the shape or table containing the text',
    },
    rowIndex: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'When targeting a table cell, the zero-based row index',
    },
    columnIndex: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'When targeting a table cell, the zero-based column index',
    },
    rangeType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Range to delete: ALL (default), FROM_START_INDEX, or FIXED_RANGE',
    },
    startIndex: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start index for FROM_START_INDEX or FIXED_RANGE',
    },
    endIndex: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'End index for FIXED_RANGE',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const objectId = params.objectId?.trim()
      if (!objectId) throw new Error('Object ID is required')

      const deleteRequest: Record<string, unknown> = {
        objectId,
        textRange: buildTextRange({
          rangeType: params.rangeType,
          startIndex: params.startIndex,
          endIndex: params.endIndex,
        }),
      }
      const cellLocation = buildCellLocation({
        rowIndex: params.rowIndex,
        columnIndex: params.columnIndex,
      })
      if (cellLocation) deleteRequest.cellLocation = cellLocation

      return { requests: [{ deleteText: deleteRequest }] }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to delete text')
    }
    const presentationId = params?.presentationId?.trim() || ''
    return {
      success: true,
      output: {
        deleted: true,
        objectId: params?.objectId?.trim() || '',
        metadata: { presentationId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the text was deleted' },
    objectId: { type: 'string', description: 'The object whose text was deleted' },
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
