import type { ToolConfig } from '@/tools/types'
import type { WebflowGetItemParams, WebflowGetItemResponse } from '@/tools/webflow/types'

export const webflowGetItemTool: ToolConfig<WebflowGetItemParams, WebflowGetItemResponse> = {
  id: 'webflow_get_item',
  name: 'Webflow Get Item',
  description: 'Get a single item from a Webflow CMS collection',
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
    itemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the item to retrieve',
    },
  },

  request: {
    url: (params) =>
      `https://api.webflow.com/v2/collections/${params.collectionId}/items/${params.itemId}`,
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
        item: data,
        metadata: {
          itemId: data.id || 'unknown',
        },
      },
    }
  },

  outputs: {
    item: {
      type: 'json',
      description: 'The retrieved item object',
    },
    metadata: {
      type: 'json',
      description: 'Metadata about the retrieved item',
    },
  },
}
