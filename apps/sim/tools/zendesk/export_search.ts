import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskExportSearch')

export interface ZendeskExportSearchParams {
  apiToken: string
  subdomain: string
  query: string
}

export interface ZendeskExportSearchResponse {
  success: boolean
  output: {
    results: any[]
    paging?: {
      nextPage?: string | null
      previousPage?: string | null
      count: number
    }
    metadata: {
      operation: 'export_search'
      totalReturned: number
    }
    success: boolean
  }
}

export const zendeskExportSearchTool: ToolConfig<
  ZendeskExportSearchParams,
  ZendeskExportSearchResponse
> = {
  id: 'zendesk_export_search',
  name: 'Export Search Results from Zendesk',
  description: 'Export search results from Zendesk (supports larger result sets)',
  version: '1.0.0',

  params: {
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
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('query', params.query)

      const query = queryParams.toString()
      const url = buildZendeskUrl(params.subdomain, '/search/export')
      return `${url}?${query}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'export_search')
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
          operation: 'export_search' as const,
          totalReturned: results.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Exported search results',
      properties: {
        results: { type: 'array', description: 'Array of result objects' },
        paging: { type: 'object', description: 'Pagination information' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
