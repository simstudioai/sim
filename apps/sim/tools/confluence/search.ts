import { SEARCH_RESULT_ITEM_PROPERTIES } from '@/tools/confluence/types'
import type { InternalToolConfig } from '@/tools/types'

export interface ConfluenceSearchParams {
  accessToken: string
  domain: string
  query: string
  limit?: number
  cloudId?: string
}

export interface ConfluenceSearchResponse {
  success: boolean
  output: {
    ts: string
    results: Array<{
      id: string
      title: string
      type: string
      url: string
      excerpt: string
    }>
  }
}

export const confluenceSearchTool: InternalToolConfig<
  ConfluenceSearchParams,
  ConfluenceSearchResponse
> = {
  id: 'confluence_search',
  name: 'Confluence Search',
  description: 'Search for content across Confluence pages, blog posts, and other content.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'confluence',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Confluence',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Your Confluence domain (e.g., yourcompany.atlassian.net)',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query string',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (default: 25)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Confluence Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  operation: {
    input: (params: ConfluenceSearchParams) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        query: params.query,
        limit: params.limit ? Number(params.limit) : 25,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        results: data.results || [],
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of search' },
    results: {
      type: 'array',
      description: 'Array of search results',
      items: {
        type: 'object',
        properties: SEARCH_RESULT_ITEM_PROPERTIES,
      },
    },
  },
}
