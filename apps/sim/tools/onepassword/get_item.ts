import type {
  OnePasswordGetItemParams,
  OnePasswordGetItemResponse,
} from '@/tools/onepassword/types'
import { FULL_ITEM_OUTPUTS, transformFullItem } from '@/tools/onepassword/utils'
import type { ToolConfig } from '@/tools/types'

export const getItemTool: ToolConfig<OnePasswordGetItemParams, OnePasswordGetItemResponse> = {
  id: 'onepassword_get_item',
  name: '1Password Get Item',
  description: 'Get full details of an item including all fields and secrets',
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
      description: 'The item UUID to retrieve',
    },
  },

  request: {
    url: (params) => {
      const base = params.serverUrl.replace(/\/$/, '')
      return `${base}/v1/vaults/${params.vaultId}/items/${params.itemId}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
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
