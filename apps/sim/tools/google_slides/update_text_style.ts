import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  buildCellLocation,
  buildTextRange,
  hexToOpaqueColor,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdateTextStyleTool')

interface UpdateTextStyleParams {
  accessToken: string
  presentationId: string
  objectId: string
  rowIndex?: number
  columnIndex?: number
  rangeType?: 'ALL' | 'FROM_START_INDEX' | 'FIXED_RANGE'
  startIndex?: number
  endIndex?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  smallCaps?: boolean
  fontFamily?: string
  fontSize?: number
  foregroundColor?: string
  backgroundColor?: string
  linkUrl?: string
  baselineOffset?: 'NONE' | 'SUPERSCRIPT' | 'SUBSCRIPT'
  styleJson?: string
  fields?: string
}

interface UpdateTextStyleResponse {
  success: boolean
  output: {
    updated: boolean
    objectId: string
    fields: string
    metadata: { presentationId: string; url: string }
  }
}

export const updateTextStyleTool: ToolConfig<UpdateTextStyleParams, UpdateTextStyleResponse> = {
  id: 'google_slides_update_text_style',
  name: 'Update Text Style in Google Slides',
  description:
    'Update the styling of text in a shape or table cell (bold, italic, font family, font size, foreground/background color, link, etc.). Only the fields you set are applied.',
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
    bold: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the text is bold',
    },
    italic: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the text is italic',
    },
    underline: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the text is underlined',
    },
    strikethrough: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the text has strikethrough',
    },
    smallCaps: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the text is rendered in small caps',
    },
    fontFamily: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Font family name (must be a font available to Google Slides)',
    },
    fontSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Font size in points',
    },
    foregroundColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Text color as hex (e.g. #1A73E8)',
    },
    backgroundColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Text background color as hex (e.g. #FFF8E1)',
    },
    linkUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Convert the range to a hyperlink with this URL',
    },
    baselineOffset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Baseline offset: NONE, SUPERSCRIPT, or SUBSCRIPT',
    },
    styleJson: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Advanced: raw TextStyle JSON merged with the simple fields above (overrides them on conflict)',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Advanced: explicit FieldMask. If omitted, the mask is computed from the fields you provided (or "*" when styleJson is used without explicit fields).',
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

      if (params.bold !== undefined) {
        style.bold = params.bold
        fieldList.push('bold')
      }
      if (params.italic !== undefined) {
        style.italic = params.italic
        fieldList.push('italic')
      }
      if (params.underline !== undefined) {
        style.underline = params.underline
        fieldList.push('underline')
      }
      if (params.strikethrough !== undefined) {
        style.strikethrough = params.strikethrough
        fieldList.push('strikethrough')
      }
      if (params.smallCaps !== undefined) {
        style.smallCaps = params.smallCaps
        fieldList.push('smallCaps')
      }
      if (params.fontFamily) {
        style.fontFamily = params.fontFamily
        fieldList.push('fontFamily')
      }
      if (params.fontSize !== undefined) {
        style.fontSize = { magnitude: params.fontSize, unit: 'PT' }
        fieldList.push('fontSize')
      }
      const fg = hexToOpaqueColor(params.foregroundColor)
      if (fg) {
        style.foregroundColor = { opaqueColor: fg }
        fieldList.push('foregroundColor')
      }
      const bg = hexToOpaqueColor(params.backgroundColor)
      if (bg) {
        style.backgroundColor = { opaqueColor: bg }
        fieldList.push('backgroundColor')
      }
      if (params.linkUrl) {
        style.link = { url: params.linkUrl }
        fieldList.push('link')
      }
      if (params.baselineOffset) {
        style.baselineOffset = params.baselineOffset
        fieldList.push('baselineOffset')
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

      return { requests: [{ updateTextStyle: updateRequest }] }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to update text style')
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
    updated: { type: 'boolean', description: 'Whether the text style was updated' },
    objectId: { type: 'string', description: 'The object whose text was styled' },
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
