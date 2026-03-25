import { createLogger } from '@sim/logger'
import type {
  HubSpotUpdateLineItemParams,
  HubSpotUpdateLineItemResponse,
} from '@/tools/hubspot/types'
import { LINE_ITEM_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotUpdateLineItem')

export const hubspotUpdateLineItemTool: ToolConfig<
  HubSpotUpdateLineItemParams,
  HubSpotUpdateLineItemResponse
> = {
  id: 'hubspot_update_line_item',
  name: 'Update Line Item in HubSpot',
  description: 'Update an existing line item in HubSpot by ID',
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
      description: 'The HubSpot line item ID to update',
    },
    idProperty: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Property to use as unique identifier. If not specified, uses record ID',
    },
    properties: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Line item properties to update as JSON object (e.g., {"quantity": "5", "price": "25.00"})',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.hubapi.com/crm/v3/objects/line_items/${params.lineItemId.trim()}`
      const queryParams = new URLSearchParams()
      if (params.idProperty) queryParams.append('idProperty', params.idProperty)
      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'PATCH',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      let properties = params.properties
      if (typeof properties === 'string') {
        try {
          properties = JSON.parse(properties)
        } catch (e) {
          throw new Error('Invalid JSON format for properties. Please provide a valid JSON object.')
        }
      }
      return { properties }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to update line item in HubSpot')
    }
    return {
      success: true,
      output: { lineItem: data, lineItemId: data.id, success: true },
    }
  },

  outputs: {
    lineItem: LINE_ITEM_OBJECT_OUTPUT,
    lineItemId: { type: 'string', description: 'The updated line item ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
