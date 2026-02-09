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
    url: (params) => {
      const base = params.serverUrl.replace(/\/$/, '')
      return `${base}/v1/vaults/${params.vaultId}/items/${params.itemId}`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => JSON.parse(params.operations),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: transformFullItem(data),
    }
  },

  outputs: FULL_ITEM_OUTPUTS,
}
