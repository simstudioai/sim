import { createLogger } from '@sim/logger'
import type { HubSpotDeleteDealParams, HubSpotDeleteDealResponse } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotDeleteDeal')

export const hubspotDeleteDealTool: ToolConfig<HubSpotDeleteDealParams, HubSpotDeleteDealResponse> =
  {
    id: 'hubspot_delete_deal',
    name: 'Delete Deal from HubSpot',
    description: 'Archive a deal in HubSpot by ID (moves it to the recycling bin)',
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
        description: 'The numeric ID of the deal to delete',
      },
    },

    request: {
      url: (params) => `https://api.hubapi.com/crm/v3/objects/deals/${params.dealId.trim()}`,
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
        throw new Error(data.message || 'Failed to delete deal from HubSpot')
      }
      return {
        success: true,
        output: {
          dealId: params?.dealId ?? '',
          deleted: true,
          success: true,
        },
      }
    },

    outputs: {
      dealId: { type: 'string', description: 'ID of the deleted deal' },
      deleted: { type: 'boolean', description: 'Whether the deal was archived' },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
