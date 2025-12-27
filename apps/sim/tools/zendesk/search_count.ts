import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskSearchCount')

export interface ZendeskSearchCountParams {
  email: string
  apiToken: string
  subdomain: string
  query: string
}

export interface ZendeskSearchCountResponse {
  success: boolean
  output: {
    count: number
    metadata: {
      operation: 'search_count'
    }
    success: boolean
  }
}

export const zendeskSearchCountTool: ToolConfig<
  ZendeskSearchCountParams,
  ZendeskSearchCountResponse
> = {
  id: 'zendesk_search_count',
  name: 'Count Search Results in Zendesk',
  description: 'Count the number of search results matching a query in Zendesk',
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
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('query', params.query)

      const query = queryParams.toString()
      const url = buildZendeskUrl(params.subdomain, '/search/count')
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
      handleZendeskError(data, response.status, 'search_count')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        count: data.count || 0,
        metadata: {
          operation: 'search_count' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    count: { type: 'number', description: 'Number of matching results' },
    metadata: { type: 'object', description: 'Operation metadata' },
  },
}
