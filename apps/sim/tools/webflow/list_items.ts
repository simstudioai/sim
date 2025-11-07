import type { ToolConfig } from '@/tools/types'
import type { WebflowListItemsParams, WebflowListItemsResponse } from '@/tools/webflow/types'

export const webflowListItemsTool: ToolConfig<WebflowListItemsParams, WebflowListItemsResponse> = {
  id: 'webflow_list_items',
  name: 'Webflow List Items',
  description: 'List all items from a Webflow CMS collection',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'webflow',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    collectionId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ID of the collection',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset for pagination (optional)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return (optional, default: 100)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.webflow.com/v2/collections/${params.collectionId}/items`
      const queryParams = new URLSearchParams()

      if (params.offset !== undefined) {
        queryParams.append('offset', Number(params.offset).toString())
      }
      if (params.limit !== undefined) {
        queryParams.append('limit', Number(params.limit).toString())
      }

      const query = queryParams.toString()
      return query ? `${baseUrl}?${query}` : baseUrl
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        items: data.items || [],
        metadata: {
          itemCount: (data.items || []).length,
          offset: data.offset,
          limit: data.limit,
        },
      },
    }
  },

  outputs: {
    items: {
      type: 'json',
      description: 'Array of collection items',
    },
    metadata: {
      type: 'json',
      description: 'Metadata about the query',
    },
  },
}
