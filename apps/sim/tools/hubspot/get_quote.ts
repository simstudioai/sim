import { createLogger } from '@sim/logger'
import type { HubSpotGetQuoteParams, HubSpotGetQuoteResponse } from '@/tools/hubspot/types'
import { QUOTE_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotGetQuote')

export const hubspotGetQuoteTool: ToolConfig<HubSpotGetQuoteParams, HubSpotGetQuoteResponse> = {
  id: 'hubspot_get_quote',
  name: 'Get Quote from HubSpot',
  description: 'Retrieve a single quote by ID from HubSpot',
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
    quoteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The HubSpot quote ID to retrieve',
    },
    idProperty: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Property to use as unique identifier. If not specified, uses record ID',
    },
    properties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of HubSpot property names to return (e.g., "hs_title,hs_expiration_date,hs_status")',
    },
    associations: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of object types to retrieve associated IDs for (e.g., "deals,line_items")',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.hubapi.com/crm/v3/objects/quotes/${params.quoteId.trim()}`
      const queryParams = new URLSearchParams()
      if (params.idProperty) queryParams.append('idProperty', params.idProperty)
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
      throw new Error(data.message || 'Failed to get quote from HubSpot')
    }
    return {
      success: true,
      output: { quote: data, quoteId: data.id, success: true },
    }
  },

  outputs: {
    quote: QUOTE_OBJECT_OUTPUT,
    quoteId: { type: 'string', description: 'The retrieved quote ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
