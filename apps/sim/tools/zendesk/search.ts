import type { ToolConfig } from '@/tools/types'
import {
  buildZendeskUrl,
  handleZendeskError,
  METADATA_OUTPUT,
  PAGING_OUTPUT,
} from '@/tools/zendesk/types'

export interface ZendeskSearchParams {
  email: string
  apiToken: string
  subdomain: string
  query: string
  filterType: string
  sortBy?: string
  sortOrder?: string
  perPage?: string
  pageAfter?: string
}

export interface ZendeskSearchResponse {
  success: boolean
  output: {
    results: any[]
    paging?: {
      after_cursor: string | null
      has_more: boolean
    }
    metadata: {
      total_returned: number
      has_more: boolean
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
      visibility: 'user-or-llm',
      description:
        'Search query string using Zendesk search syntax (e.g., "type:ticket status:open")',
    },
    filterType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Resource type to search for: "ticket", "user", "organization", or "group"',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort field: "relevance", "created_at", "updated_at", "priority", "status", or "ticket_type"',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: "asc" or "desc"',
    },
    perPage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page as a number string (default: "100", max: "100")',
    },
    pageAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from a previous response to fetch the next page of results',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('query', params.query)
      queryParams.append('filter[type]', params.filterType)
      if (params.sortBy) queryParams.append('sort_by', params.sortBy)
      if (params.sortOrder) queryParams.append('sort_order', params.sortOrder)
      if (params.perPage) queryParams.append('page[size]', params.perPage)
      if (params.pageAfter) queryParams.append('page[after]', params.pageAfter)

      const query = queryParams.toString()
      const url = buildZendeskUrl(params.subdomain, '/search/export')
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
    const afterCursor = data.meta?.after_cursor ?? null
    const hasMore = data.meta?.has_more ?? false

    return {
      success: true,
      output: {
        results,
        paging: {
          after_cursor: afterCursor,
          has_more: hasMore,
        },
        metadata: {
          total_returned: results.length,
          has_more: hasMore,
        },
        success: true,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description:
        'Array of result objects (tickets, users, or organizations depending on search query)',
    },
    paging: PAGING_OUTPUT,
    metadata: METADATA_OUTPUT,
  },
}
