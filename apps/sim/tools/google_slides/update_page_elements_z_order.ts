import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdatePageElementsZOrderTool')

interface UpdatePageElementsZOrderParams {
  accessToken: string
  presentationId: string
  objectIds: string
  operation: 'BRING_TO_FRONT' | 'BRING_FORWARD' | 'SEND_BACKWARD' | 'SEND_TO_BACK'
}

interface UpdatePageElementsZOrderResponse {
  success: boolean
  output: {
    reordered: boolean
    objectIds: string[]
    operation: string
    metadata: { presentationId: string; url: string }
  }
}

export const updatePageElementsZOrderTool: ToolConfig<
  UpdatePageElementsZOrderParams,
  UpdatePageElementsZOrderResponse
> = {
  id: 'google_slides_update_page_elements_z_order',
  name: 'Update Z-Order in Google Slides',
  description: 'Bring elements to front, send to back, or step them one layer forward/backward.',
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
    objectIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated object IDs of the elements to reorder',
    },
    operation: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'BRING_TO_FRONT, BRING_FORWARD, SEND_BACKWARD, or SEND_TO_BACK',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const objectIds = (params.objectIds || '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
      if (objectIds.length === 0) throw new Error('At least one object ID is required')
      if (!params.operation) throw new Error('Operation is required')

      return {
        requests: [
          {
            updatePageElementsZOrder: {
              pageElementObjectIds: objectIds,
              operation: params.operation,
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
      throw new Error(data.error?.message || 'Failed to update z-order')
    }
    const presentationId = params?.presentationId?.trim() || ''
    const objectIds = (params?.objectIds || '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
    return {
      success: true,
      output: {
        reordered: true,
        objectIds,
        operation: params?.operation ?? '',
        metadata: { presentationId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    reordered: { type: 'boolean', description: 'Whether the z-order was changed' },
    objectIds: { type: 'array', description: 'Elements reordered', items: { type: 'string' } },
    operation: { type: 'string', description: 'Operation applied' },
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
