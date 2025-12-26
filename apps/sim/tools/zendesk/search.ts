import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskSearch')

export interface ZendeskSearchParams {
  email: string
  apiToken: string
  subdomain: string
  query: string
  sortBy?: string
  sortOrder?: string
  perPage?: string
  page?: string
}

export interface ZendeskSearchResponse {
  success: boolean
  output: {
    results: any[]
    paging?: {
      nextPage?: string | null
      previousPage?: string | null
      count: number
    }
    metadata: {
      operation: 'search'
      totalReturned: number
    }
    success: boolean
  }
}

export const zendeskSearchTool: ToolConfig<ZendeskSearchParams, ZendeskSearchResponse> = {
  id: 'zendesk_search',
  name: 'Search Zendesk',
  description: 'Unified search across tickets, users, and organizations in Zendesk',
  version: '1.0.0',

  params: {
    email: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zendesk email address',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Zendesk API token',
    },
    subdomain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zendesk subdomain',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Search query string',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort field (relevance, created_at, updated_at, priority, status, ticket_type)',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort order (asc or desc)',
    },
    perPage: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Results per page (default: 100, max: 100)',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Page number',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('query', params.query)
      if (params.sortBy) queryParams.append('sort_by', params.sortBy)
      if (params.sortOrder) queryParams.append('sort_order', params.sortOrder)
      if (params.page) queryParams.append('page', params.page)
      if (params.perPage) queryParams.append('per_page', params.perPage)

      const query = queryParams.toString()
      const url = buildZendeskUrl(params.subdomain, '/search')
      return `${url}?${query}`
    },
    method: 'GET',
    headers: (params) => {
      const credentials = `${params.email}/token:${params.apiToken}`
      const base64Credentials = Buffer.from(credentials).toString('base64')
      return {
        Authorization: `Basic ${base64Credentials}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'search')
    }

    const data = await response.json()
    const results = data.results || []

    return {
      success: true,
      output: {
        results,
        paging: {
          nextPage: data.next_page,
          previousPage: data.previous_page,
          count: data.count || results.length,
        },
        metadata: {
          operation: 'search' as const,
          totalReturned: results.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    results: { type: 'array', description: 'Array of result objects' },
    paging: { type: 'object', description: 'Pagination information' },
    metadata: { type: 'object', description: 'Operation metadata' },
  },
}
