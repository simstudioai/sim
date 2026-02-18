import type { ToolConfig } from '@/tools/types'
import type { VercelGetEdgeConfigParams, VercelGetEdgeConfigResponse } from '@/tools/vercel/types'

export const vercelGetEdgeConfigTool: ToolConfig<
  VercelGetEdgeConfigParams,
  VercelGetEdgeConfigResponse
> = {
  id: 'vercel_get_edge_config',
  name: 'Vercel Get Edge Config',
  description: 'Get details about a specific Edge Config store',
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
      description: 'Edge Config ID to look up',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelGetEdgeConfigParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/edge-config/${params.edgeConfigId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelGetEdgeConfigParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id ?? null,
        slug: data.slug ?? null,
        ownerId: data.ownerId ?? null,
        digest: data.digest ?? null,
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
        itemCount: data.itemCount ?? 0,
        sizeInBytes: data.sizeInBytes ?? 0,
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Edge Config ID',
    },
    slug: {
      type: 'string',
      description: 'Edge Config slug',
    },
    ownerId: {
      type: 'string',
      description: 'Owner ID',
    },
    digest: {
      type: 'string',
      description: 'Content digest hash',
    },
    createdAt: {
      type: 'number',
      description: 'Creation timestamp',
    },
    updatedAt: {
      type: 'number',
      description: 'Last update timestamp',
    },
    itemCount: {
      type: 'number',
      description: 'Number of items',
    },
    sizeInBytes: {
      type: 'number',
      description: 'Size in bytes',
    },
  },
}
