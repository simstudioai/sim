import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  PT_TO_EMU,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdatePageElementTransformTool')

interface UpdatePageElementTransformParams {
  accessToken: string
  presentationId: string
  objectId: string
  scaleX?: number
  scaleY?: number
  shearX?: number
  shearY?: number
  translateX?: number
  translateY?: number
  applyMode?: 'ABSOLUTE' | 'RELATIVE'
}

interface UpdatePageElementTransformResponse {
  success: boolean
  output: {
    updated: boolean
    objectId: string
    metadata: { presentationId: string; url: string }
  }
}

export const updatePageElementTransformTool: ToolConfig<
  UpdatePageElementTransformParams,
  UpdatePageElementTransformResponse
> = {
  id: 'google_slides_update_page_element_transform',
  name: 'Update Page Element Transform in Google Slides',
  description:
    'Move, resize, scale, or shear a page element. Translate is specified in points; applyMode controls whether the transform is absolute (default) or relative (multiplied with the current transform).',
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
      description: 'Object ID of the page element to transform',
    },
    scaleX: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Horizontal scale factor (default 1)',
    },
    scaleY: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Vertical scale factor (default 1)',
    },
    shearX: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Horizontal shear factor (default 0)',
    },
    shearY: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Vertical shear factor (default 0)',
    },
    translateX: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'X position in points (absolute) or delta (relative)',
    },
    translateY: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Y position in points (absolute) or delta (relative)',
    },
    applyMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ABSOLUTE replaces the current transform; RELATIVE multiplies with it. Default ABSOLUTE.',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const objectId = params.objectId?.trim()
      if (!objectId) throw new Error('Object ID is required')

      const transform: Record<string, unknown> = {
        unit: 'EMU',
      }
      transform.scaleX = params.scaleX ?? 1
      transform.scaleY = params.scaleY ?? 1
      if (params.shearX !== undefined) transform.shearX = params.shearX
      if (params.shearY !== undefined) transform.shearY = params.shearY
      if (params.translateX !== undefined) transform.translateX = params.translateX * PT_TO_EMU
      if (params.translateY !== undefined) transform.translateY = params.translateY * PT_TO_EMU

      return {
        requests: [
          {
            updatePageElementTransform: {
              objectId,
              transform,
              applyMode: params.applyMode || 'ABSOLUTE',
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
      throw new Error(data.error?.message || 'Failed to update transform')
    }
    const presentationId = params?.presentationId?.trim() || ''
    return {
      success: true,
      output: {
        updated: true,
        objectId: params?.objectId?.trim() || '',
        metadata: { presentationId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    updated: { type: 'boolean', description: 'Whether the transform was updated' },
    objectId: { type: 'string', description: 'The element transformed' },
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
