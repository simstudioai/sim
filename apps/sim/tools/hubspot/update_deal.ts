import { createLogger } from '@sim/logger'
import type { HubSpotUpdateDealParams, HubSpotUpdateDealResponse } from '@/tools/hubspot/types'
import { DEAL_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotUpdateDeal')

export const hubspotUpdateDealTool: ToolConfig<HubSpotUpdateDealParams, HubSpotUpdateDealResponse> =
  {
    id: 'hubspot_update_deal',
    name: 'Update Deal in HubSpot',
    description: 'Update an existing deal in HubSpot by ID',
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
      dealId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The HubSpot deal ID to update',
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
          'Deal properties to update as JSON object (e.g., {"amount": "10000", "dealstage": "closedwon"})',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = `https://api.hubapi.com/crm/v3/objects/deals/${params.dealId.trim()}`
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
            throw new Error(
              'Invalid JSON format for properties. Please provide a valid JSON object.'
            )
          }
        }
        return { properties }
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      if (!response.ok) {
        logger.error('HubSpot API request failed', { data, status: response.status })
        throw new Error(data.message || 'Failed to update deal in HubSpot')
      }
      return {
        success: true,
        output: { deal: data, dealId: data.id, success: true },
      }
    },

    outputs: {
      deal: DEAL_OBJECT_OUTPUT,
      dealId: { type: 'string', description: 'The updated deal ID' },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
