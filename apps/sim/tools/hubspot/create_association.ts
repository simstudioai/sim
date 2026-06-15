import { createLogger } from '@sim/logger'
import type {
  HubSpotCreateAssociationParams,
  HubSpotCreateAssociationResponse,
} from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotCreateAssociation')

export const hubspotCreateAssociationTool: ToolConfig<
  HubSpotCreateAssociationParams,
  HubSpotCreateAssociationResponse
> = {
  id: 'hubspot_create_association',
  name: 'Create Association in HubSpot',
  description:
    'Associate two HubSpot records. Creates the default (unlabeled) association unless an association type ID is provided',
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
      description: 'Source object type (e.g., "emails", "notes", "contacts")',
    },
    objectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the source record',
    },
    toObjectType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target object type to associate to (e.g., "contacts", "companies", "deals")',
    },
    toObjectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the target record',
    },
    associationCategory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Association category for a labeled association (HUBSPOT_DEFINED, USER_DEFINED, INTEGRATOR_DEFINED). Defaults to HUBSPOT_DEFINED when an association type ID is provided',
    },
    associationTypeId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Specific association type ID for a labeled association. Omit to create the default association for the object pair',
    },
  },

  request: {
    url: (params) => {
      const from = `${encodeURIComponent(params.objectType.trim())}/${encodeURIComponent(params.objectId.trim())}`
      const to = `${encodeURIComponent(params.toObjectType.trim())}/${encodeURIComponent(params.toObjectId.trim())}`

      return params.associationTypeId != null
        ? `https://api.hubapi.com/crm/v4/objects/${from}/associations/${to}`
        : `https://api.hubapi.com/crm/v4/objects/${from}/associations/default/${to}`
    },
    method: 'PUT',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${params.accessToken}`,
      }
      if (params.associationTypeId != null) {
        headers['Content-Type'] = 'application/json'
      }
      return headers
    },
    body: (params) => {
      if (params.associationTypeId == null) {
        return undefined
      }

      return [
        {
          associationCategory: params.associationCategory || 'HUBSPOT_DEFINED',
          associationTypeId: params.associationTypeId,
        },
      ]
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to create association in HubSpot')
    }

    const batchResult = Array.isArray(data.results) ? data.results[0] : undefined

    return {
      success: true,
      output: {
        fromObjectId: data.fromObjectId ?? batchResult?.from?.id ?? params?.objectId ?? '',
        toObjectId: data.toObjectId ?? batchResult?.to?.id ?? params?.toObjectId ?? '',
        labels: data.labels ?? [],
        success: true,
      },
    }
  },

  outputs: {
    fromObjectId: { type: 'string', description: 'ID of the source record' },
    toObjectId: { type: 'string', description: 'ID of the associated target record' },
    labels: {
      type: 'array',
      description: 'Association labels (empty for default associations)',
      items: { type: 'string', description: 'Association label' },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
