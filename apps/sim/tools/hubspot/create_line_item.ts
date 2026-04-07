import { createLogger } from '@sim/logger'
import type {
  HubSpotCreateLineItemParams,
  HubSpotCreateLineItemResponse,
} from '@/tools/hubspot/types'
import { LINE_ITEM_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotCreateLineItem')

export const hubspotCreateLineItemTool: ToolConfig<
  HubSpotCreateLineItemParams,
  HubSpotCreateLineItemResponse
> = {
  id: 'hubspot_create_line_item',
  name: 'Create Line Item in HubSpot',
  description: 'Create a new line item in HubSpot. Requires at least a name property',
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
    properties: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Line item properties as JSON object (e.g., {"name": "Product A", "quantity": "2", "price": "50.00", "hs_sku": "SKU-001"})',
    },
    associations: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of associations to create with the line item as JSON. Each object should have "to.id" and "types" array with "associationCategory" and "associationTypeId"',
    },
  },

  request: {
    url: () => 'https://api.hubapi.com/crm/v3/objects/line_items',
    method: 'POST',
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
      const body: Record<string, unknown> = { properties }
      if (params.associations && params.associations.length > 0) {
        body.associations = params.associations
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to create line item in HubSpot')
    }
    return {
      success: true,
      output: { lineItem: data, lineItemId: data.id, success: true },
    }
  },

  outputs: {
    lineItem: LINE_ITEM_OBJECT_OUTPUT,
    lineItemId: { type: 'string', description: 'The created line item ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
