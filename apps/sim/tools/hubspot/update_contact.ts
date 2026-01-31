import { createLogger } from '@sim/logger'
import type {
  HubSpotUpdateContactParams,
  HubSpotUpdateContactResponse,
} from '@/tools/hubspot/types'
import { CONTACT_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotUpdateContact')

export const hubspotUpdateContactTool: ToolConfig<
  HubSpotUpdateContactParams,
  HubSpotUpdateContactResponse
> = {
  id: 'hubspot_update_contact',
  name: 'Update Contact in HubSpot',
  description: 'Update an existing contact in HubSpot by ID or email',
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
      description: 'The HubSpot contact ID (numeric string) or email of the contact to update',
    },
    idProperty: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Property to use as unique identifier (e.g., "email"). If not specified, uses record ID',
    },
    properties: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Contact properties to update as JSON object (e.g., {"firstname": "John", "phone": "+1234567890"})',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${params.contactId}`
      if (params.idProperty) {
        return `${baseUrl}?idProperty=${params.idProperty}`
      }
      return baseUrl
    },
    method: 'PATCH',
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
          throw new Error('Invalid JSON format for properties. Please provide a valid JSON object.')
        }
      }

      return {
        properties,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to update contact in HubSpot')
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
    contactId: { type: 'string', description: 'The updated contact ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
