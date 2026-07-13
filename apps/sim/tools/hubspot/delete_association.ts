import { createLogger } from '@sim/logger'
import type {
  HubSpotDeleteAssociationParams,
  HubSpotDeleteAssociationResponse,
} from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotDeleteAssociation')

export const hubspotDeleteAssociationTool: ToolConfig<
  HubSpotDeleteAssociationParams,
  HubSpotDeleteAssociationResponse
> = {
  id: 'hubspot_delete_association',
  name: 'Delete Association in HubSpot',
  description: 'Remove all associations between two HubSpot records',
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
    objectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the source record',
    },
    toObjectType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target object type (e.g., "emails", "notes", "contacts")',
    },
    toObjectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the target record',
    },
  },

  request: {
    url: (params) => {
      const from = `${encodeURIComponent(params.objectType.trim())}/${encodeURIComponent(params.objectId.trim())}`
      const to = `${encodeURIComponent(params.toObjectType.trim())}/${encodeURIComponent(params.toObjectId.trim())}`
      return `https://api.hubapi.com/crm/v4/objects/${from}/associations/${to}`
    },
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
      throw new Error(data.message || 'Failed to delete association in HubSpot')
    }
    return {
      success: true,
      output: {
        fromObjectId: params?.objectId ?? '',
        toObjectId: params?.toObjectId ?? '',
        deleted: true,
        success: true,
      },
    }
  },

  outputs: {
    fromObjectId: { type: 'string', description: 'Source record ID' },
    toObjectId: { type: 'string', description: 'Target record ID' },
    deleted: { type: 'boolean', description: 'Whether the associations were removed' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
