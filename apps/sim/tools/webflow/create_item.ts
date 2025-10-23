import type { ToolConfig } from '@/tools/types'
import type { WebflowCreateItemParams, WebflowCreateItemResponse } from '@/tools/webflow/types'

export const webflowCreateItemTool: ToolConfig<WebflowCreateItemParams, WebflowCreateItemResponse> =
  {
    id: 'webflow_create_item',
    name: 'Webflow Create Item',
    description: 'Create a new item in a Webflow CMS collection',
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
      fieldData: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Field data for the new item as a JSON object. Keys should match collection field names.',
      },
    },

    request: {
      url: (params) => `https://api.webflow.com/v2/collections/${params.collectionId}/items`,
      method: 'POST',
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
        description: 'The created item object',
      },
      metadata: {
        type: 'json',
        description: 'Metadata about the created item',
      },
    },
  }
