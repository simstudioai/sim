import { createLogger } from '@/lib/logs/console/logger'
import type {
  HubSpotSearchCompaniesParams,
  HubSpotSearchCompaniesResponse,
} from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotSearchCompanies')

export const hubspotSearchCompaniesTool: ToolConfig<
  HubSpotSearchCompaniesParams,
  HubSpotSearchCompaniesResponse
> = {
  id: 'hubspot_search_companies',
  name: 'Search Companies in HubSpot',
  description: 'Search for companies in HubSpot using filters, sorting, and queries',
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
      visibility: 'user-only',
      description:
        'Array of filter groups. Each group contains filters with propertyName, operator, and value',
    },
    sorts: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description:
        'Array of sort objects with propertyName and direction ("ASCENDING" or "DESCENDING")',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Search query string',
    },
    properties: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Array of property names to return',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results to return (max 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Pagination cursor for next page',
    },
  },

  request: {
    url: () => 'https://api.hubapi.com/crm/v3/objects/companies/search',
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

      if (params.filterGroups && params.filterGroups.length > 0) {
        body.filterGroups = params.filterGroups
      }
      if (params.sorts && params.sorts.length > 0) {
        body.sorts = params.sorts
      }
      if (params.query) {
        body.query = params.query
      }
      if (params.properties && params.properties.length > 0) {
        body.properties = params.properties
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
      throw new Error(data.message || 'Failed to search companies in HubSpot')
    }

    return {
      success: true,
      output: {
        companies: data.results || [],
        total: data.total,
        paging: data.paging,
        metadata: {
          operation: 'search_companies' as const,
          totalReturned: data.results?.length || 0,
          total: data.total,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Search results',
      properties: {
        companies: {
          type: 'array',
          description: 'Array of matching company objects',
        },
        total: {
          type: 'number',
          description: 'Total number of matching companies',
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
