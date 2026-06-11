import type {
  RootlyDeleteActionItemParams,
  RootlyDeleteActionItemResponse,
} from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyDeleteActionItemTool: ToolConfig<
  RootlyDeleteActionItemParams,
  RootlyDeleteActionItemResponse
> = {
  id: 'rootly_delete_action_item',
  name: 'Rootly Delete Action Item',
  description: 'Delete a Rootly incident action item.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rootly API key',
    },
    actionItemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the action item to delete',
    },
  },

  request: {
    url: (params) => `https://api.rootly.com/v1/action_items/${params.actionItemId.trim()}`,
    method: 'DELETE',
    headers: (params) => ({
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { success: false, message: '' },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    return {
      success: true,
      output: {
        success: true,
        message: 'Action item deleted successfully',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the action item was deleted',
    },
    message: {
      type: 'string',
      description: 'Result message',
    },
  },
}
