import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  buildElementProperties,
  generateObjectId,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesCreateLineTool')

interface CreateLineParams {
  accessToken: string
  presentationId: string
  pageObjectId: string
  lineCategory?: 'STRAIGHT' | 'BENT' | 'CURVED'
  width?: number
  height?: number
  positionX?: number
  positionY?: number
}

interface CreateLineResponse {
  success: boolean
  output: {
    lineId: string
    lineCategory: string
    metadata: { presentationId: string; pageObjectId: string; url: string }
  }
}

export const createLineTool: ToolConfig<CreateLineParams, CreateLineResponse> = {
  id: 'google_slides_create_line',
  name: 'Create Line in Google Slides',
  description: 'Create a line or connector on a slide.',
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
    pageObjectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object ID of the slide to add the line to',
    },
    lineCategory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'STRAIGHT (default), BENT, or CURVED',
    },
    width: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Line width in points (default 200)',
    },
    height: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Line height in points (default 0 — horizontal line)',
    },
    positionX: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'X position in points (default 100)',
    },
    positionY: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Y position in points (default 100)',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const pageObjectId = params.pageObjectId?.trim()
      if (!pageObjectId) throw new Error('Page Object ID is required')

      const objectId = generateObjectId('line')
      const elementProperties = buildElementProperties({
        pageObjectId,
        width: params.width,
        height: params.height ?? 1,
        positionX: params.positionX,
        positionY: params.positionY,
        defaultWidth: 200,
        defaultHeight: 1,
      })

      return {
        requests: [
          {
            createLine: {
              objectId,
              lineCategory: params.lineCategory || 'STRAIGHT',
              elementProperties,
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
      throw new Error(data.error?.message || 'Failed to create line')
    }
    const lineId = data.replies?.[0]?.createLine?.objectId ?? ''
    const presentationId = params?.presentationId?.trim() || ''
    const pageObjectId = params?.pageObjectId?.trim() || ''
    return {
      success: true,
      output: {
        lineId,
        lineCategory: params?.lineCategory || 'STRAIGHT',
        metadata: { presentationId, pageObjectId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    lineId: { type: 'string', description: 'Object ID of the new line' },
    lineCategory: { type: 'string', description: 'Line category created' },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        pageObjectId: { type: 'string', description: 'The slide ID' },
        url: { type: 'string', description: 'URL to the presentation' },
      },
    },
  },
}
