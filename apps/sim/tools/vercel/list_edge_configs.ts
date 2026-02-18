import type { ToolConfig } from '@/tools/types'
import type {
  VercelListEdgeConfigsParams,
  VercelListEdgeConfigsResponse,
} from '@/tools/vercel/types'

export const vercelListEdgeConfigsTool: ToolConfig<
  VercelListEdgeConfigsParams,
  VercelListEdgeConfigsResponse
> = {
  id: 'vercel_list_edge_configs',
  name: 'Vercel List Edge Configs',
  description: 'List all Edge Config stores for a team',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelListEdgeConfigsParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/edge-config${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelListEdgeConfigsParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const items = Array.isArray(data) ? data : (data.edgeConfigs ?? [])
    const edgeConfigs = items.map((ec: any) => ({
      id: ec.id ?? null,
      slug: ec.slug ?? null,
      ownerId: ec.ownerId ?? null,
      digest: ec.digest ?? null,
      createdAt: ec.createdAt ?? null,
      updatedAt: ec.updatedAt ?? null,
      itemCount: ec.itemCount ?? 0,
      sizeInBytes: ec.sizeInBytes ?? 0,
    }))

    return {
      success: true,
      output: {
        edgeConfigs,
        count: edgeConfigs.length,
      },
    }
  },

  outputs: {
    edgeConfigs: {
      type: 'array',
      description: 'List of Edge Config stores',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Edge Config ID' },
          slug: { type: 'string', description: 'Edge Config slug' },
          ownerId: { type: 'string', description: 'Owner ID' },
          digest: { type: 'string', description: 'Content digest hash' },
          createdAt: { type: 'number', description: 'Creation timestamp' },
          updatedAt: { type: 'number', description: 'Last update timestamp' },
          itemCount: { type: 'number', description: 'Number of items' },
          sizeInBytes: { type: 'number', description: 'Size in bytes' },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of Edge Configs returned',
    },
  },
}
