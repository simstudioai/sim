import type {
  OnePasswordCreateItemParams,
  OnePasswordCreateItemResponse,
} from '@/tools/onepassword/types'
import { FULL_ITEM_OUTPUTS, transformFullItem } from '@/tools/onepassword/utils'
import type { ToolConfig } from '@/tools/types'

export const createItemTool: ToolConfig<
  OnePasswordCreateItemParams,
  OnePasswordCreateItemResponse
> = {
  id: 'onepassword_create_item',
  name: '1Password Create Item',
  description: 'Create a new item in a vault',
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
      description: 'The vault UUID to create the item in',
    },
    category: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Item category (e.g., LOGIN, PASSWORD, API_CREDENTIAL, SECURE_NOTE, SERVER, DATABASE)',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Item title',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tags',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of field objects (e.g., [{"label":"username","value":"admin","type":"STRING","purpose":"USERNAME"}])',
    },
  },

  request: {
    url: '/api/tools/onepassword/create-item',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      connectionMode: params.connectionMode,
      serviceAccountToken: params.serviceAccountToken,
      serverUrl: params.serverUrl,
      apiKey: params.apiKey,
      vaultId: params.vaultId,
      category: params.category,
      title: params.title,
      tags: params.tags,
      fields: params.fields,
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
