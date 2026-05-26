import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  buildCellLocation,
  buildTextRange,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesCreateParagraphBulletsTool')

interface CreateParagraphBulletsParams {
  accessToken: string
  presentationId: string
  objectId: string
  rowIndex?: number
  columnIndex?: number
  rangeType?: 'ALL' | 'FROM_START_INDEX' | 'FIXED_RANGE'
  startIndex?: number
  endIndex?: number
  bulletPreset?: string
}

interface CreateParagraphBulletsResponse {
  success: boolean
  output: {
    created: boolean
    objectId: string
    metadata: { presentationId: string; url: string }
  }
}

export const createParagraphBulletsTool: ToolConfig<
  CreateParagraphBulletsParams,
  CreateParagraphBulletsResponse
> = {
  id: 'google_slides_create_paragraph_bullets',
  name: 'Create Paragraph Bullets in Google Slides',
  description:
    'Convert paragraphs in a shape or table cell into a bulleted or numbered list using a Google Slides bullet preset.',
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
      description: 'Range to apply bullets to: ALL (default), FROM_START_INDEX, or FIXED_RANGE',
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
    bulletPreset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Bullet preset (e.g. BULLET_DISC_CIRCLE_SQUARE, BULLET_ARROW_DIAMOND_DISC, NUMBERED_DIGIT_ALPHA_ROMAN, NUMBERED_DIGIT_ALPHA_ROMAN_PARENS, NUMBERED_DIGIT_NESTED). Defaults to BULLET_DISC_CIRCLE_SQUARE.',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const objectId = params.objectId?.trim()
      if (!objectId) throw new Error('Object ID is required')

      const createRequest: Record<string, unknown> = {
        objectId,
        textRange: buildTextRange({
          rangeType: params.rangeType,
          startIndex: params.startIndex,
          endIndex: params.endIndex,
        }),
        bulletPreset: params.bulletPreset?.trim() || 'BULLET_DISC_CIRCLE_SQUARE',
      }
      const cellLocation = buildCellLocation({
        rowIndex: params.rowIndex,
        columnIndex: params.columnIndex,
      })
      if (cellLocation) createRequest.cellLocation = cellLocation

      return { requests: [{ createParagraphBullets: createRequest }] }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to create paragraph bullets')
    }
    const presentationId = params?.presentationId?.trim() || ''
    return {
      success: true,
      output: {
        created: true,
        objectId: params?.objectId?.trim() || '',
        metadata: { presentationId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    created: { type: 'boolean', description: 'Whether bullets were created' },
    objectId: { type: 'string', description: 'The object where bullets were created' },
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
