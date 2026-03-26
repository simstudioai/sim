import { createLogger } from '@sim/logger'
import type { HubSpotGetCartParams, HubSpotGetCartResponse } from '@/tools/hubspot/types'
import { GENERIC_CRM_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotGetCart')

export const hubspotGetCartTool: ToolConfig<HubSpotGetCartParams, HubSpotGetCartResponse> = {
  id: 'hubspot_get_cart',
  name: 'Get Cart from HubSpot',
  description: 'Retrieve a single cart by ID from HubSpot',
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
    cartId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The HubSpot cart ID to retrieve',
    },
    properties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of HubSpot property names to return',
    },
    associations: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of object types to retrieve associated IDs for',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.hubapi.com/crm/v3/objects/carts/${params.cartId.trim()}`
      const queryParams = new URLSearchParams()
      if (params.properties) queryParams.append('properties', params.properties)
      if (params.associations) queryParams.append('associations', params.associations)
      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to get cart from HubSpot')
    }
    return {
      success: true,
      output: { cart: data, cartId: data.id, success: true },
    }
  },

  outputs: {
    cart: GENERIC_CRM_OBJECT_OUTPUT,
    cartId: { type: 'string', description: 'The retrieved cart ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
