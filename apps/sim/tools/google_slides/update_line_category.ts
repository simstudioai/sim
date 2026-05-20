import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdateLineCategoryTool')

interface UpdateLineCategoryParams {
  accessToken: string
  presentationId: string
  objectId: string
  lineCategory: 'STRAIGHT' | 'BENT' | 'CURVED'
}

interface UpdateLineCategoryResponse {
  success: boolean
  output: {
    updated: boolean
    objectId: string
    lineCategory: string
    metadata: { presentationId: string; url: string }
  }
}

export const updateLineCategoryTool: ToolConfig<
  UpdateLineCategoryParams,
  UpdateLineCategoryResponse
> = {
  id: 'google_slides_update_line_category',
  name: 'Update Line Category in Google Slides',
  description: "Change a connector line's category (STRAIGHT, BENT, or CURVED).",
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
      description: 'Object ID of the connector line',
    },
    lineCategory: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New line category: STRAIGHT, BENT, or CURVED',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const objectId = params.objectId?.trim()
      if (!objectId) throw new Error('Object ID is required')
      if (!params.lineCategory) throw new Error('Line category is required')

      return {
        requests: [
          {
            updateLineCategory: {
              objectId,
              lineCategory: params.lineCategory,
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
      throw new Error(data.error?.message || 'Failed to update line category')
    }
    const presentationId = params?.presentationId?.trim() || ''
    return {
      success: true,
      output: {
        updated: true,
        objectId: params?.objectId?.trim() || '',
        lineCategory: params?.lineCategory ?? '',
        metadata: { presentationId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    updated: { type: 'boolean', description: 'Whether the line category was updated' },
    objectId: { type: 'string', description: 'The line object updated' },
    lineCategory: { type: 'string', description: 'New line category' },
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
