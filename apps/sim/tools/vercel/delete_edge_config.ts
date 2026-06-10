import type { ToolConfig } from '@/tools/types'
import type {
  VercelDeleteEdgeConfigParams,
  VercelDeleteEdgeConfigResponse,
} from '@/tools/vercel/types'

export const vercelDeleteEdgeConfigTool: ToolConfig<
  VercelDeleteEdgeConfigParams,
  VercelDeleteEdgeConfigResponse
> = {
  id: 'vercel_delete_edge_config',
  name: 'Vercel Delete Edge Config',
  description: 'Delete an Edge Config store by ID',
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
      description: 'Edge Config ID to delete',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelDeleteEdgeConfigParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/edge-config/${params.edgeConfigId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'DELETE',
    headers: (params: VercelDeleteEdgeConfigParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async () => {
    return {
      success: true,
      output: {
        deleted: true,
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the Edge Config was successfully deleted',
    },
  },
}
