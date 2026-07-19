import { createLogger } from '@sim/logger'
import type {
  HubSpotDeleteLineItemParams,
  HubSpotDeleteLineItemResponse,
} from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotDeleteLineItem')

export const hubspotDeleteLineItemTool: ToolConfig<
  HubSpotDeleteLineItemParams,
  HubSpotDeleteLineItemResponse
> = {
  id: 'hubspot_delete_line_item',
  name: 'Delete Line Item from HubSpot',
  description: 'Archive a line item in HubSpot by ID (moves it to the recycling bin)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the HubSpot API',
    },
    lineItemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The numeric ID of the line item to delete',
    },
  },

  request: {
    url: (params) => `https://api.hubapi.com/crm/v3/objects/line_items/${params.lineItemId.trim()}`,
    method: 'DELETE',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to delete line item from HubSpot')
    }
    return {
      success: true,
      output: {
        lineItemId: params?.lineItemId ?? '',
        deleted: true,
        success: true,
      },
    }
  },

  outputs: {
    lineItemId: { type: 'string', description: 'ID of the deleted line item' },
    deleted: { type: 'boolean', description: 'Whether the line item was archived' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
