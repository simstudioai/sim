import { createLogger } from '@sim/logger'
import type { HubSpotGetContactParams, HubSpotGetContactResponse } from '@/tools/hubspot/types'
import { CONTACT_OBJECT_OUTPUT } from '@/tools/hubspot/types'
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
        visibility: 'user-or-llm',
        description: 'The HubSpot contact ID (numeric string) or email address to retrieve',
      },
      idProperty: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Property to use as unique identifier (e.g., "email"). If not specified, uses record ID',
      },
      properties: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated list of HubSpot property names to return (e.g., "email,firstname,lastname,phone")',
      },
      associations: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated list of object types to retrieve associated IDs for (e.g., "companies,deals")',
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
          contactId: data.id,
          success: true,
        },
      }
    },

    outputs: {
      contact: CONTACT_OBJECT_OUTPUT,
      contactId: { type: 'string', description: 'The retrieved contact ID' },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
