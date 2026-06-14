import { createLogger } from '@sim/logger'
import type {
  HubSpotGetPropertiesParams,
  HubSpotGetPropertiesResponse,
} from '@/tools/hubspot/types'
import { PROPERTIES_ARRAY_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotGetProperties')

export const hubspotGetPropertiesTool: ToolConfig<
  HubSpotGetPropertiesParams,
  HubSpotGetPropertiesResponse
> = {
  id: 'hubspot_get_properties',
  name: 'Get Properties from HubSpot',
  description:
    'Read property definitions and their enumeration (picklist) options for a HubSpot object type, e.g. the values for lifecyclestage or hs_lead_status on contacts',
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
      description:
        'Object type to read properties for (e.g., "contacts", "companies", "deals", "tickets", "line_items", "quotes")',
    },
    propertyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Internal name of a single property to retrieve (e.g., "hs_lead_status"). Omit to return all properties for the object type',
    },
    archived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to return only archived properties (default false)',
    },
  },

  request: {
    url: (params) => {
      const objectType = params.objectType.trim()
      const baseUrl = params.propertyName
        ? `https://api.hubapi.com/crm/v3/properties/${encodeURIComponent(objectType)}/${encodeURIComponent(params.propertyName.trim())}`
        : `https://api.hubapi.com/crm/v3/properties/${encodeURIComponent(objectType)}`

      const queryParams = new URLSearchParams()
      if (params.archived !== undefined) {
        queryParams.append('archived', String(params.archived))
      }

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

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to get properties from HubSpot')
    }

    const properties = Array.isArray(data.results) ? data.results : [data]

    return {
      success: true,
      output: {
        properties,
        metadata: {
          totalReturned: properties.length,
          objectType: params?.objectType ?? '',
        },
        success: true,
      },
    }
  },

  outputs: {
    properties: PROPERTIES_ARRAY_OUTPUT,
    metadata: {
      type: 'object',
      description: 'Response metadata',
      properties: {
        totalReturned: { type: 'number', description: 'Number of property definitions returned' },
        objectType: { type: 'string', description: 'Object type the properties belong to' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
