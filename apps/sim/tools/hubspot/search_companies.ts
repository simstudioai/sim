import { createLogger } from '@sim/logger'
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
      throw new Error(data.message || 'Failed to search companies in HubSpot')
    }

    const result = {
      companies: data.results || [],
      total: data.total,
      paging: data.paging,
      metadata: {
        operation: 'search_companies' as const,
        totalReturned: data.results?.length || 0,
        total: data.total,
      },
    }

    return {
      success: true,
      output: result,
      ...result,
    }
  },

  outputs: {
    companies: { type: 'array', description: 'Array of matching HubSpot company objects' },
    total: { type: 'number', description: 'Total number of matching companies' },
    paging: { type: 'object', description: 'Pagination information' },
    metadata: { type: 'object', description: 'Operation metadata' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
