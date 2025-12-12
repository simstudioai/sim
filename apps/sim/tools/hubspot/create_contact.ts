import { createLogger } from '@/lib/logs/console/logger'
import type {
  HubSpotCreateContactParams,
  HubSpotCreateContactResponse,
} from '@/tools/hubspot/types'
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
      visibility: 'user-only',
      description:
        'Contact properties as JSON object. Must include at least one of: email, firstname, or lastname',
    },
    associations: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description:
        'Array of associations to create with the contact (e.g., companies, deals). Each object should have "to" (with "id") and "types" (with "associationCategory" and "associationTypeId")',
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
      const body: any = {
        properties: params.properties,
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
        metadata: {
          operation: 'create_contact' as const,
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
      description: 'Created contact data',
      properties: {
        contact: {
          type: 'object',
          description: 'Created contact object with properties and ID',
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
