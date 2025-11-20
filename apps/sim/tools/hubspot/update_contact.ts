import { createLogger } from '@/lib/logs/console/logger'
import type {
  HubSpotUpdateContactParams,
  HubSpotUpdateContactResponse,
} from '@/tools/hubspot/types'
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
      visibility: 'user-only',
      description: 'The ID or email of the contact to update',
    },
    idProperty: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Property to use as unique identifier (e.g., "email"). If not specified, uses record ID',
    },
    properties: {
      type: 'object',
      required: true,
      visibility: 'user-only',
      description: 'Contact properties to update as JSON object',
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
      return {
        properties: params.properties,
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
        metadata: {
          operation: 'update_contact' as const,
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
      description: 'Updated contact data',
      properties: {
        contact: {
          type: 'object',
          description: 'Updated contact object with properties',
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
