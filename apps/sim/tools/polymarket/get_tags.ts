import type { ToolConfig } from '@/tools/types'
import type { PolymarketPaginationParams, PolymarketTag } from './types'
import { buildGammaUrl, handlePolymarketError } from './types'

export interface PolymarketGetTagsParams extends PolymarketPaginationParams {}

export interface PolymarketGetTagsResponse {
  success: boolean
  output: {
    tags: PolymarketTag[]
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
        description: 'Number of results per page (max 50)',
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
        // Default limit to 50 to prevent browser crashes from large data sets
        queryParams.append('limit', params.limit || '50')
        if (params.offset) queryParams.append('offset', params.offset)

        const query = queryParams.toString()
        const url = buildGammaUrl('/tags')
        return `${url}?${query}`
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
        },
      }
    },

    outputs: {
      tags: {
        type: 'array',
        description: 'Array of tag objects with id, label, and slug',
      },
    },
  }
