import { createLogger } from '@sim/logger'
import type { HubSpotGetListParams, HubSpotGetListResponse } from '@/tools/hubspot/types'
import { LIST_OUTPUT_PROPERTIES } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotGetList')

export const hubspotGetListTool: ToolConfig<HubSpotGetListParams, HubSpotGetListResponse> = {
  id: 'hubspot_get_list',
  name: 'Get List from HubSpot',
  description: 'Retrieve a single list by ID from HubSpot',
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
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The HubSpot list ID to retrieve',
    },
  },

  request: {
    url: (params) => `https://api.hubapi.com/crm/v3/lists/${params.listId.trim()}`,
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
      throw new Error(data.message || 'Failed to get list from HubSpot')
    }
    return {
      success: true,
      output: {
        list: data.list ?? data,
        listId: data.list?.listId ?? data.listId ?? data.id,
        success: true,
      },
    }
  },

  outputs: {
    list: {
      type: 'object',
      description: 'HubSpot list',
      properties: LIST_OUTPUT_PROPERTIES,
    },
    listId: { type: 'string', description: 'The retrieved list ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
