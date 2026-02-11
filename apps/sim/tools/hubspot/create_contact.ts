import { createLogger } from '@sim/logger'
import type {
  HubSpotCreateContactParams,
  HubSpotCreateContactResponse,
} from '@/tools/hubspot/types'
import { CONTACT_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotCreateContact')

export const hubspotCreateContactTool: ToolConfig<
  HubSpotCreateContactParams,
  HubSpotCreateContactResponse
> = {
  id: 'hubspot_create_contact',
  name: 'Create Contact in HubSpot',
  description:
    'Create a new contact in HubSpot. Requires at least one of: email, firstname, or lastname',
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
    properties: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Contact properties as JSON object. Must include at least one of: email, firstname, or lastname (e.g., {"email": "john@example.com", "firstname": "John", "lastname": "Doe"})',
    },
    associations: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of associations to create with the contact as JSON. Each object should have "to.id" (company/deal ID) and "types" array with "associationCategory" and "associationTypeId"',
    },
  },

  request: {
    url: () => 'https://api.hubapi.com/crm/v3/objects/contacts',
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
    body: (params) => {
      let properties = params.properties
      if (typeof properties === 'string') {
        try {
          properties = JSON.parse(properties)
        } catch (e) {
          throw new Error('Invalid JSON format for properties. Please provide a valid JSON object.')
        }
      }

      const body: any = {
        properties,
      }

      if (params.associations && params.associations.length > 0) {
        body.associations = params.associations
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to create contact in HubSpot')
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
    contactId: { type: 'string', description: 'The created contact ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
