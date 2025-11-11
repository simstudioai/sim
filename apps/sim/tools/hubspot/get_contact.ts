import { createLogger } from '@/lib/logs/console/logger'
import type { HubSpotGetContactParams, HubSpotGetContactResponse } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotGetContact')

export const hubspotGetContactTool: ToolConfig<HubSpotGetContactParams, HubSpotGetContactResponse> =
  {
    id: 'hubspot_get_contact',
    name: 'Get Contact from HubSpot',
    description: 'Retrieve a single contact by ID or email from HubSpot',
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
      contactId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'The ID or email of the contact to retrieve',
      },
      idProperty: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description:
          'Property to use as unique identifier (e.g., "email"). If not specified, uses record ID',
      },
      properties: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Comma-separated list of properties to return',
      },
      associations: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Comma-separated list of object types to retrieve associated IDs for',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${params.contactId}`
        const queryParams = new URLSearchParams()

        if (params.idProperty) {
          queryParams.append('idProperty', params.idProperty)
        }
        if (params.properties) {
          queryParams.append('properties', params.properties)
        }
        if (params.associations) {
          queryParams.append('associations', params.associations)
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

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        logger.error('HubSpot API request failed', { data, status: response.status })
        throw new Error(data.message || 'Failed to get contact from HubSpot')
      }

      return {
        success: true,
        output: {
          contact: data,
          metadata: {
            operation: 'get_contact' as const,
            contactId: data.id,
          },
          success: true,
        },
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Operation success status' },
      output: {
        type: 'object',
        description: 'Contact data',
        properties: {
          contact: {
            type: 'object',
            description: 'Contact object with properties',
          },
          metadata: {
            type: 'object',
            description: 'Operation metadata',
          },
          success: { type: 'boolean', description: 'Operation success status' },
        },
      },
    },
  }
