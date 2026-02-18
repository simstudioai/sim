import type { ToolConfig } from '@/tools/types'
import type {
  VercelGetEdgeConfigItemsParams,
  VercelGetEdgeConfigItemsResponse,
} from '@/tools/vercel/types'

export const vercelGetEdgeConfigItemsTool: ToolConfig<
  VercelGetEdgeConfigItemsParams,
  VercelGetEdgeConfigItemsResponse
> = {
  id: 'vercel_get_edge_config_items',
  name: 'Vercel Get Edge Config Items',
  description: 'Get all items in an Edge Config store',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    edgeConfigId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Edge Config ID to get items from',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelGetEdgeConfigItemsParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/edge-config/${params.edgeConfigId.trim()}/items${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelGetEdgeConfigItemsParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const rawItems = Array.isArray(data) ? data : (data.items ?? [])
    const items = rawItems.map((item: any) => ({
      key: item.key ?? null,
      value: item.value ?? null,
      description: item.description ?? null,
      edgeConfigId: item.edgeConfigId ?? null,
      createdAt: item.createdAt ?? null,
      updatedAt: item.updatedAt ?? null,
    }))

    return {
      success: true,
      output: {
        items,
        count: items.length,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'List of Edge Config items',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Item key' },
          value: { type: 'json', description: 'Item value' },
          description: { type: 'string', description: 'Item description' },
          edgeConfigId: { type: 'string', description: 'Parent Edge Config ID' },
          createdAt: { type: 'number', description: 'Creation timestamp' },
          updatedAt: { type: 'number', description: 'Last update timestamp' },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of items returned',
    },
  },
}
