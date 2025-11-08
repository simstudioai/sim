import { createLogger } from '@/lib/logs/console/logger'
import type { HubSpotListContactsParams, HubSpotListContactsResponse } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotListContacts')

export const hubspotListContactsTool: ToolConfig<
  HubSpotListContactsParams,
  HubSpotListContactsResponse
> = {
  id: 'hubspot_list_contacts',
  name: 'List Contacts from HubSpot',
  description: 'Retrieve all contacts from HubSpot account with pagination support',
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
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results per page (max 100, default 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Pagination cursor for next page of results',
    },
    properties: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Comma-separated list of properties to return (e.g., "email,firstname,lastname")',
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
      const baseUrl = 'https://api.hubapi.com/crm/v3/objects/contacts'
      const queryParams = new URLSearchParams()

      if (params.limit) {
        queryParams.append('limit', params.limit)
      }
      if (params.after) {
        queryParams.append('after', params.after)
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
      throw new Error(data.message || 'Failed to list contacts from HubSpot')
    }

    return {
      success: true,
      output: {
        contacts: data.results || [],
        paging: data.paging,
        metadata: {
          operation: 'list_contacts' as const,
          totalReturned: data.results?.length || 0,
          hasMore: !!data.paging?.next,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Contacts data',
      properties: {
        contacts: {
          type: 'array',
          description: 'Array of contact objects',
        },
        paging: {
          type: 'object',
          description: 'Pagination information',
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
