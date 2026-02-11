import type {
  OnePasswordUpdateItemParams,
  OnePasswordUpdateItemResponse,
} from '@/tools/onepassword/types'
import { FULL_ITEM_OUTPUTS, transformFullItem } from '@/tools/onepassword/utils'
import type { ToolConfig } from '@/tools/types'

export const updateItemTool: ToolConfig<
  OnePasswordUpdateItemParams,
  OnePasswordUpdateItemResponse
> = {
  id: 'onepassword_update_item',
  name: '1Password Update Item',
  description: 'Update an existing item using JSON Patch operations (RFC6902)',
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
      description: 'The item UUID to update',
    },
    operations: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of RFC6902 patch operations (e.g., [{"op":"replace","path":"/title","value":"New Title"}])',
    },
  },

  request: {
    url: '/api/tools/onepassword/update-item',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      connectionMode: params.connectionMode,
      serviceAccountToken: params.serviceAccountToken,
      serverUrl: params.serverUrl,
      apiKey: params.apiKey,
      vaultId: params.vaultId,
      itemId: params.itemId,
      operations: params.operations,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (data.error) {
      return { success: false, output: transformFullItem({}), error: data.error }
    }
    return {
      success: true,
      output: transformFullItem(data),
    }
  },

  outputs: FULL_ITEM_OUTPUTS,
}
