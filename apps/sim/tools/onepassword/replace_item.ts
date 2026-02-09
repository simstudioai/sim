import type {
  OnePasswordReplaceItemParams,
  OnePasswordReplaceItemResponse,
} from '@/tools/onepassword/types'
import { FULL_ITEM_OUTPUTS, transformFullItem } from '@/tools/onepassword/utils'
import type { ToolConfig } from '@/tools/types'

export const replaceItemTool: ToolConfig<
  OnePasswordReplaceItemParams,
  OnePasswordReplaceItemResponse
> = {
  id: 'onepassword_replace_item',
  name: '1Password Replace Item',
  description: 'Replace an entire item with new data (full update)',
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
      description: 'The item UUID to replace',
    },
    item: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object representing the full item (e.g., {"vault":{"id":"..."},"category":"LOGIN","title":"My Item","fields":[...]})',
    },
  },

  request: {
    url: (params) => {
      const base = params.serverUrl.replace(/\/$/, '')
      return `${base}/v1/vaults/${params.vaultId}/items/${params.itemId}`
    },
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => JSON.parse(params.item),
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
