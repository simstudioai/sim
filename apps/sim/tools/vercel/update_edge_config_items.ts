import type { ToolConfig } from '@/tools/types'
import type {
  VercelUpdateEdgeConfigItemsParams,
  VercelUpdateEdgeConfigItemsResponse,
} from '@/tools/vercel/types'

export const vercelUpdateEdgeConfigItemsTool: ToolConfig<
  VercelUpdateEdgeConfigItemsParams,
  VercelUpdateEdgeConfigItemsResponse
> = {
  id: 'vercel_update_edge_config_items',
  name: 'Vercel Update Edge Config Items',
  description: 'Create, update, upsert, or delete items in an Edge Config store',
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
      description: 'Edge Config ID to update items in',
    },
    items: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of operations: [{operation: "create"|"update"|"upsert"|"delete", key: string, value?: any}]',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelUpdateEdgeConfigItemsParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/edge-config/${params.edgeConfigId.trim()}/items${qs ? `?${qs}` : ''}`
    },
    method: 'PATCH',
    headers: (params: VercelUpdateEdgeConfigItemsParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: VercelUpdateEdgeConfigItemsParams) => {
      const parsedItems = typeof params.items === 'string' ? JSON.parse(params.items) : params.items
      return { items: parsedItems }
    },
  },

  transformResponse: async () => {
    return {
      success: true,
      output: {
        status: 'ok',
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Operation status',
    },
  },
}
