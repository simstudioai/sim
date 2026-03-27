import { createLogger } from '@sim/logger'
import type { HubSpotCreateDealParams, HubSpotCreateDealResponse } from '@/tools/hubspot/types'
import { DEAL_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotCreateDeal')

export const hubspotCreateDealTool: ToolConfig<HubSpotCreateDealParams, HubSpotCreateDealResponse> =
  {
    id: 'hubspot_create_deal',
    name: 'Create Deal in HubSpot',
    description: 'Create a new deal in HubSpot. Requires at least a dealname property',
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
          'Deal properties as JSON object. Must include dealname (e.g., {"dealname": "New Deal", "amount": "5000", "dealstage": "appointmentscheduled"})',
      },
      associations: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Array of associations to create with the deal as JSON. Each object should have "to.id" and "types" array with "associationCategory" and "associationTypeId"',
      },
    },

    request: {
      url: () => 'https://api.hubapi.com/crm/v3/objects/deals',
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
            throw new Error(
              'Invalid JSON format for properties. Please provide a valid JSON object.'
            )
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
        throw new Error(data.message || 'Failed to create deal in HubSpot')
      }
      return {
        success: true,
        output: { deal: data, dealId: data.id, success: true },
      }
    },

    outputs: {
      deal: DEAL_OBJECT_OUTPUT,
      dealId: { type: 'string', description: 'The created deal ID' },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
