import type {
  OnePasswordDeleteItemParams,
  OnePasswordDeleteItemResponse,
} from '@/tools/onepassword/types'
import type { ToolConfig } from '@/tools/types'

export const deleteItemTool: ToolConfig<
  OnePasswordDeleteItemParams,
  OnePasswordDeleteItemResponse
> = {
  id: 'onepassword_delete_item',
  name: '1Password Delete Item',
  description: 'Delete an item from a vault',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: '1Password Connect API token',
    },
    serverUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: '1Password Connect server URL (e.g., http://localhost:8080)',
    },
    vaultId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The vault UUID',
    },
    itemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The item UUID to delete',
    },
  },

  request: {
    url: (params) => {
      const base = params.serverUrl.replace(/\/$/, '')
      return `${base}/v1/vaults/${params.vaultId}/items/${params.itemId}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async () => {
    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the item was successfully deleted' },
  },
}
