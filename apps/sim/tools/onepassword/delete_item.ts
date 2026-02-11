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
    connectionMode: {
      type: 'string',
      required: false,
      description: 'Connection mode: "service_account" or "connect"',
    },
    serviceAccountToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: '1Password Service Account token (for Service Account mode)',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: '1Password Connect API token (for Connect Server mode)',
    },
    serverUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: '1Password Connect server URL (for Connect Server mode)',
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
    url: '/api/tools/onepassword/delete-item',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      connectionMode: params.connectionMode,
      serviceAccountToken: params.serviceAccountToken,
      serverUrl: params.serverUrl,
      apiKey: params.apiKey,
      vaultId: params.vaultId,
      itemId: params.itemId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (data.error) {
      return { success: false, output: { success: false }, error: data.error }
    }
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
