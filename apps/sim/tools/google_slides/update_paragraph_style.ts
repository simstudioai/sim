import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  buildCellLocation,
  buildTextRange,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdateParagraphStyleTool')

interface UpdateParagraphStyleParams {
  accessToken: string
  presentationId: string
  objectId: string
  rowIndex?: number
  columnIndex?: number
  rangeType?: 'ALL' | 'FROM_START_INDEX' | 'FIXED_RANGE'
  startIndex?: number
  endIndex?: number
  alignment?: 'START' | 'CENTER' | 'END' | 'JUSTIFIED'
  lineSpacing?: number
  indentStart?: number
  indentEnd?: number
  indentFirstLine?: number
  spaceAbove?: number
  spaceBelow?: number
  direction?: 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT'
  spacingMode?: 'NEVER_COLLAPSE' | 'COLLAPSE_LISTS'
  styleJson?: string
  fields?: string
}

interface UpdateParagraphStyleResponse {
  success: boolean
  output: {
    updated: boolean
    objectId: string
    fields: string
    metadata: { presentationId: string; url: string }
  }
}

export const updateParagraphStyleTool: ToolConfig<
  UpdateParagraphStyleParams,
  UpdateParagraphStyleResponse
> = {
  id: 'google_slides_update_paragraph_style',
  name: 'Update Paragraph Style in Google Slides',
  description:
    'Update paragraph styling — alignment, line spacing, indents, space above/below — for text in a shape or table cell.',
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
      description: 'Range to style: ALL (default), FROM_START_INDEX, or FIXED_RANGE',
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
    alignment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Text alignment: START, CENTER, END, or JUSTIFIED',
    },
    lineSpacing: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Line spacing as a percentage (100 = single, 200 = double)',
    },
    indentStart: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start-edge indent in points',
    },
    indentEnd: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'End-edge indent in points',
    },
    indentFirstLine: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'First-line indent in points',
    },
    spaceAbove: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Space above the paragraph in points',
    },
    spaceBelow: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Space below the paragraph in points',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Text direction: LEFT_TO_RIGHT or RIGHT_TO_LEFT',
    },
    spacingMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Spacing mode: NEVER_COLLAPSE or COLLAPSE_LISTS',
    },
    styleJson: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Advanced: raw ParagraphStyle JSON merged with the simple fields above',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Advanced: explicit FieldMask. If omitted, computed from provided fields.',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const objectId = params.objectId?.trim()
      if (!objectId) throw new Error('Object ID is required')

      const style: Record<string, unknown> = {}
      const fieldList: string[] = []

      const ptDim = (pt: number) => ({ magnitude: pt, unit: 'PT' })

      if (params.alignment) {
        style.alignment = params.alignment
        fieldList.push('alignment')
      }
      if (params.lineSpacing !== undefined) {
        style.lineSpacing = params.lineSpacing
        fieldList.push('lineSpacing')
      }
      if (params.indentStart !== undefined) {
        style.indentStart = ptDim(params.indentStart)
        fieldList.push('indentStart')
      }
      if (params.indentEnd !== undefined) {
        style.indentEnd = ptDim(params.indentEnd)
        fieldList.push('indentEnd')
      }
      if (params.indentFirstLine !== undefined) {
        style.indentFirstLine = ptDim(params.indentFirstLine)
        fieldList.push('indentFirstLine')
      }
      if (params.spaceAbove !== undefined) {
        style.spaceAbove = ptDim(params.spaceAbove)
        fieldList.push('spaceAbove')
      }
      if (params.spaceBelow !== undefined) {
        style.spaceBelow = ptDim(params.spaceBelow)
        fieldList.push('spaceBelow')
      }
      if (params.direction) {
        style.direction = params.direction
        fieldList.push('direction')
      }
      if (params.spacingMode) {
        style.spacingMode = params.spacingMode
        fieldList.push('spacingMode')
      }

      if (params.styleJson?.trim()) {
        try {
          const extra = JSON.parse(params.styleJson)
          if (extra && typeof extra === 'object') {
            Object.assign(style, extra)
          }
        } catch (e) {
          logger.warn('Invalid styleJson, ignoring:', { error: e })
        }
      }

      const fields = params.fields?.trim() || (fieldList.length > 0 ? fieldList.join(',') : '*')

      const updateRequest: Record<string, unknown> = {
        objectId,
        style,
        textRange: buildTextRange({
          rangeType: params.rangeType,
          startIndex: params.startIndex,
          endIndex: params.endIndex,
        }),
        fields,
      }
      const cellLocation = buildCellLocation({
        rowIndex: params.rowIndex,
        columnIndex: params.columnIndex,
      })
      if (cellLocation) updateRequest.cellLocation = cellLocation

      return { requests: [{ updateParagraphStyle: updateRequest }] }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to update paragraph style')
    }
    const presentationId = params?.presentationId?.trim() || ''
    return {
      success: true,
      output: {
        updated: true,
        objectId: params?.objectId?.trim() || '',
        fields: params?.fields?.trim() || '',
        metadata: { presentationId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    updated: { type: 'boolean', description: 'Whether the paragraph style was updated' },
    objectId: { type: 'string', description: 'The object whose paragraph was styled' },
    fields: { type: 'string', description: 'FieldMask applied' },
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
