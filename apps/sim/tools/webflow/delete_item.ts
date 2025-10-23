import type { ToolConfig } from '@/tools/types'
import type { WebflowDeleteItemParams, WebflowDeleteItemResponse } from '@/tools/webflow/types'

export const webflowDeleteItemTool: ToolConfig<WebflowDeleteItemParams, WebflowDeleteItemResponse> =
  {
    id: 'webflow_delete_item',
    name: 'Webflow Delete Item',
    description: 'Delete an item from a Webflow CMS collection',
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
        description: 'ID of the item to delete',
      },
    },

    request: {
      url: (params) =>
        `https://api.webflow.com/v2/collections/${params.collectionId}/items/${params.itemId}`,
      method: 'DELETE',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
      }),
    },

    transformResponse: async (response) => {
      const isSuccess = response.status === 204 || response.ok

      return {
        success: isSuccess,
        output: {
          success: isSuccess,
          metadata: {
            deleted: isSuccess,
          },
        },
      }
    },

    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the deletion was successful',
      },
      metadata: {
        type: 'json',
        description: 'Metadata about the deletion',
      },
    },
  }
