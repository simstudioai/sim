import type {
  OnePasswordListItemsParams,
  OnePasswordListItemsResponse,
} from '@/tools/onepassword/types'
import type { ToolConfig } from '@/tools/types'

export const listItemsTool: ToolConfig<OnePasswordListItemsParams, OnePasswordListItemsResponse> = {
  id: 'onepassword_list_items',
  name: '1Password List Items',
  description: 'List items in a vault. Returns summaries without field values.',
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
      description: 'The vault UUID to list items from',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SCIM filter expression (e.g., title eq "API Key" or tag eq "production")',
    },
  },

  request: {
    url: '/api/tools/onepassword/list-items',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      connectionMode: params.connectionMode,
      serviceAccountToken: params.serviceAccountToken,
      serverUrl: params.serverUrl,
      apiKey: params.apiKey,
      vaultId: params.vaultId,
      filter: params.filter,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (data.error) {
      return { success: false, output: { items: [] }, error: data.error }
    }
    const items = Array.isArray(data) ? data : [data]
    return {
      success: true,
      output: {
        items: items.map((item: any) => ({
          id: item.id ?? null,
          title: item.title ?? null,
          vault: item.vault ?? null,
          category: item.category ?? null,
          urls: (item.urls ?? []).map((url: any) => ({
            href: url.href ?? null,
            label: url.label ?? null,
            primary: url.primary ?? false,
          })),
          favorite: item.favorite ?? false,
          tags: item.tags ?? [],
          version: item.version ?? 0,
          state: item.state ?? null,
          createdAt: item.createdAt ?? null,
          updatedAt: item.updatedAt ?? null,
          lastEditedBy: item.lastEditedBy ?? null,
        })),
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'List of items in the vault (summaries without field values)',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Item ID' },
          title: { type: 'string', description: 'Item title' },
          vault: {
            type: 'object',
            description: 'Vault reference',
            properties: {
              id: { type: 'string', description: 'Vault ID' },
            },
          },
          category: { type: 'string', description: 'Item category (e.g., LOGIN, API_CREDENTIAL)' },
          urls: {
            type: 'array',
            description: 'URLs associated with the item',
            optional: true,
            items: {
              type: 'object',
              properties: {
                href: { type: 'string', description: 'URL' },
                label: { type: 'string', description: 'URL label', optional: true },
                primary: { type: 'boolean', description: 'Whether this is the primary URL' },
              },
            },
          },
          favorite: { type: 'boolean', description: 'Whether the item is favorited' },
          tags: { type: 'array', description: 'Item tags' },
          version: { type: 'number', description: 'Item version number' },
          state: {
            type: 'string',
            description: 'Item state (ARCHIVED or DELETED)',
            optional: true,
          },
          createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
          updatedAt: { type: 'string', description: 'Last update timestamp', optional: true },
          lastEditedBy: { type: 'string', description: 'ID of the last editor', optional: true },
        },
      },
    },
  },
}
