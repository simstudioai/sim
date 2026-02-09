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
    url: (params) => {
      const base = params.serverUrl.replace(/\/$/, '')
      return `${base}/v1/vaults/${params.vaultId}/items`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        vault: { id: params.vaultId },
        category: params.category,
      }

      if (params.title) {
        body.title = params.title
      }

      if (params.tags) {
        body.tags = params.tags.split(',').map((t) => t.trim())
      }

      if (params.fields) {
        body.fields = JSON.parse(params.fields)
      }

      return body
    },
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
