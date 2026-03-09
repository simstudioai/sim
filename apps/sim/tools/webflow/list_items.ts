import type { ToolConfig } from '@/tools/types'
import type { WebflowListItemsParams, WebflowListItemsResponse } from '@/tools/webflow/types'
import {
  WEBFLOW_ITEM_OUTPUT_PROPERTIES,
  WEBFLOW_LIST_METADATA_OUTPUT_PROPERTIES,
} from '@/tools/webflow/types'

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
    siteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the Webflow site (e.g., "580e63e98c9a982ac9b8b741")',
    },
    collectionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the collection (e.g., "580e63fc8c9a982ac9b8b745")',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset for pagination (e.g., 0, 100, 200)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return (e.g., 10, 50, 100; default: 100)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.webflow.com/v2/collections/${params.collectionId}/items`
      const queryParams = new URLSearchParams()

      if (params.offset) {
        queryParams.append('offset', Number(params.offset).toString())
      }
      if (params.limit) {
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
      type: 'array',
      description: 'Array of collection items',
      items: {
        type: 'object',
        properties: WEBFLOW_ITEM_OUTPUT_PROPERTIES,
      },
    },
    metadata: {
      type: 'object',
      description: 'Metadata about the query',
      properties: WEBFLOW_LIST_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
