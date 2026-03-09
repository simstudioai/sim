import type { ToolConfig } from '@/tools/types'
import type { WebflowUpdateItemParams, WebflowUpdateItemResponse } from '@/tools/webflow/types'

export const webflowUpdateItemTool: ToolConfig<WebflowUpdateItemParams, WebflowUpdateItemResponse> =
  {
    id: 'webflow_update_item',
    name: 'Webflow Update Item',
    description: 'Update an existing item in a Webflow CMS collection',
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
      itemId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the item to update (e.g., "580e64008c9a982ac9b8b754")',
      },
      fieldData: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Field data to update as a JSON object. Only include fields you want to change.',
      },
    },

    request: {
      url: (params) =>
        `https://api.webflow.com/v2/collections/${params.collectionId}/items/${params.itemId}`,
      method: 'PATCH',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        fieldData: params.fieldData,
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
        description: 'The updated item object',
      },
      metadata: {
        type: 'json',
        description: 'Metadata about the updated item',
      },
    },
  }
