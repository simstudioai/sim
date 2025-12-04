import type { ToolConfig } from '@/tools/types'
import type { PolymarketPaginationParams, PolymarketTag } from './types'
import { buildGammaUrl, handlePolymarketError } from './types'

export interface PolymarketGetTagsParams extends PolymarketPaginationParams {}

export interface PolymarketGetTagsResponse {
  success: boolean
  output: {
    tags: PolymarketTag[]
    metadata: {
      operation: 'get_tags'
      totalReturned: number
    }
    success: boolean
  }
}

export const polymarketGetTagsTool: ToolConfig<PolymarketGetTagsParams, PolymarketGetTagsResponse> =
  {
    id: 'polymarket_get_tags',
    name: 'Get Tags from Polymarket',
    description: 'Retrieve available tags for filtering markets from Polymarket',
    version: '1.0.0',

    params: {
      limit: {
        type: 'string',
        required: false,
        description: 'Number of results per page (recommended: 25-50)',
      },
      offset: {
        type: 'string',
        required: false,
        description: 'Pagination offset (skip this many results)',
      },
    },

    request: {
      url: (params) => {
        const queryParams = new URLSearchParams()
        if (params.limit) queryParams.append('limit', params.limit)
        if (params.offset) queryParams.append('offset', params.offset)

        const query = queryParams.toString()
        const url = buildGammaUrl('/tags')
        return query ? `${url}?${query}` : url
      },
      method: 'GET',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        handlePolymarketError(data, response.status, 'get_tags')
      }

      // Response is an array of tags
      const tags = Array.isArray(data) ? data : []

      return {
        success: true,
        output: {
          tags,
          metadata: {
            operation: 'get_tags' as const,
            totalReturned: tags.length,
          },
          success: true,
        },
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Operation success status' },
      output: {
        type: 'object',
        description: 'Tags data and metadata',
        properties: {
          tags: { type: 'array', description: 'Array of tag objects' },
          metadata: { type: 'object', description: 'Operation metadata' },
          success: { type: 'boolean', description: 'Operation success' },
        },
      },
    },
  }
