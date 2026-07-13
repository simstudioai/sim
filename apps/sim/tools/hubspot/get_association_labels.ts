import { createLogger } from '@sim/logger'
import type {
  HubSpotGetAssociationLabelsParams,
  HubSpotGetAssociationLabelsResponse,
} from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotGetAssociationLabels')

export const hubspotGetAssociationLabelsTool: ToolConfig<
  HubSpotGetAssociationLabelsParams,
  HubSpotGetAssociationLabelsResponse
> = {
  id: 'hubspot_get_association_labels',
  name: 'Get Association Labels from HubSpot',
  description:
    'Retrieve the association types (category, typeId, label) defined between two HubSpot object types',
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
    objectType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The source object type (e.g., "contacts", "companies", "deals")',
    },
    toObjectType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target object type (e.g., "emails", "notes", "contacts")',
    },
  },

  request: {
    url: (params) => {
      const from = encodeURIComponent(params.objectType.trim())
      const to = encodeURIComponent(params.toObjectType.trim())
      return `https://api.hubapi.com/crm/v4/associations/${from}/${to}/labels`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to get association labels from HubSpot')
    }
    return {
      success: true,
      output: {
        labels: data.results || [],
        success: true,
      },
    }
  },

  outputs: {
    labels: {
      type: 'array',
      description: 'Association types defined between the two object types',
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Association category (HUBSPOT_DEFINED or USER_DEFINED)',
          },
          typeId: { type: 'number', description: 'Association type ID' },
          label: {
            type: 'string',
            description: 'Human-readable label (null for unlabeled defaults)',
            optional: true,
          },
        },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
