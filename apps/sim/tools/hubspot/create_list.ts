import { createLogger } from '@sim/logger'
import type { HubSpotCreateListParams, HubSpotCreateListResponse } from '@/tools/hubspot/types'
import { LIST_OUTPUT_PROPERTIES } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotCreateList')

export const hubspotCreateListTool: ToolConfig<HubSpotCreateListParams, HubSpotCreateListResponse> =
  {
    id: 'hubspot_create_list',
    name: 'Create List in HubSpot',
    description:
      'Create a new list in HubSpot. Specify the object type and processing type (MANUAL or DYNAMIC)',
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
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Name of the list',
      },
      objectTypeId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Object type ID (e.g., "0-1" for contacts, "0-2" for companies)',
      },
      processingType: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Processing type: "MANUAL" for static lists or "DYNAMIC" for active lists',
      },
    },

    request: {
      url: () => 'https://api.hubapi.com/crm/v3/lists',
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
      body: (params) => ({
        name: params.name,
        objectTypeId: params.objectTypeId,
        processingType: params.processingType,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      if (!response.ok) {
        logger.error('HubSpot API request failed', { data, status: response.status })
        throw new Error(data.message || 'Failed to create list in HubSpot')
      }
      return {
        success: true,
        output: { list: data, listId: data.listId ?? data.id, success: true },
      }
    },

    outputs: {
      list: {
        type: 'object',
        description: 'HubSpot list',
        properties: LIST_OUTPUT_PROPERTIES,
      },
      listId: { type: 'string', description: 'The created list ID' },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
