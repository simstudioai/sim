import { createLogger } from '@sim/logger'
import type {
  HubSpotSearchContactsParams,
  HubSpotSearchContactsResponse,
} from '@/tools/hubspot/types'
import { CONTACTS_ARRAY_OUTPUT, METADATA_OUTPUT, PAGING_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotSearchContacts')

export const hubspotSearchContactsTool: ToolConfig<
  HubSpotSearchContactsParams,
  HubSpotSearchContactsResponse
> = {
  id: 'hubspot_search_contacts',
  name: 'Search Contacts in HubSpot',
  description: 'Search for contacts in HubSpot using filters, sorting, and queries',
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
    filterGroups: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of filter groups as JSON. Each group contains "filters" array with objects having "propertyName", "operator" (e.g., "EQ", "CONTAINS"), and "value"',
    },
    sorts: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of sort objects as JSON with "propertyName" and "direction" ("ASCENDING" or "DESCENDING")',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search query string to match against contact name, email, and other text fields',
    },
    properties: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of HubSpot property names to return (e.g., ["email", "firstname", "lastname", "phone"])',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (max 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for next page (from previous response)',
    },
  },

  request: {
    url: () => 'https://api.hubapi.com/crm/v3/objects/contacts/search',
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
      const body: any = {}

      if (params.filterGroups) {
        let parsedFilterGroups = params.filterGroups
        if (typeof params.filterGroups === 'string') {
          try {
            parsedFilterGroups = JSON.parse(params.filterGroups)
          } catch (e) {
            throw new Error(`Invalid JSON for filterGroups: ${(e as Error).message}`)
          }
        }
        if (Array.isArray(parsedFilterGroups) && parsedFilterGroups.length > 0) {
          body.filterGroups = parsedFilterGroups
        }
      }
      if (params.sorts) {
        let parsedSorts = params.sorts
        if (typeof params.sorts === 'string') {
          try {
            parsedSorts = JSON.parse(params.sorts)
          } catch (e) {
            throw new Error(`Invalid JSON for sorts: ${(e as Error).message}`)
          }
        }
        if (Array.isArray(parsedSorts) && parsedSorts.length > 0) {
          body.sorts = parsedSorts
        }
      }
      if (params.query) {
        body.query = params.query
      }
      if (params.properties) {
        let parsedProperties = params.properties
        if (typeof params.properties === 'string') {
          try {
            parsedProperties = JSON.parse(params.properties)
          } catch (e) {
            throw new Error(`Invalid JSON for properties: ${(e as Error).message}`)
          }
        }
        if (Array.isArray(parsedProperties) && parsedProperties.length > 0) {
          body.properties = parsedProperties
        }
      }
      if (params.limit) {
        body.limit = params.limit
      }
      if (params.after) {
        body.after = params.after
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to search contacts in HubSpot')
    }

    return {
      success: true,
      output: {
        contacts: data.results || [],
        total: data.total ?? null,
        paging: data.paging ?? null,
        metadata: {
          totalReturned: data.results?.length || 0,
          hasMore: !!data.paging?.next,
        },
        success: true,
      },
    }
  },

  outputs: {
    contacts: CONTACTS_ARRAY_OUTPUT,
    total: { type: 'number', description: 'Total number of matching contacts', optional: true },
    paging: PAGING_OUTPUT,
    metadata: METADATA_OUTPUT,
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
