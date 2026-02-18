import type { ToolConfig } from '@/tools/types'
import type { VercelDeleteEnvVarParams, VercelDeleteEnvVarResponse } from '@/tools/vercel/types'

export const vercelDeleteEnvVarTool: ToolConfig<
  VercelDeleteEnvVarParams,
  VercelDeleteEnvVarResponse
> = {
  id: 'vercel_delete_env_var',
  name: 'Vercel Delete Environment Variable',
  description: 'Delete an environment variable from a Vercel project',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID or name',
    },
    envId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Environment variable ID to delete',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelDeleteEnvVarParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v9/projects/${params.projectId.trim()}/env/${params.envId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'DELETE',
    headers: (params: VercelDeleteEnvVarParams) => ({
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
      description: 'Whether the environment variable was successfully deleted',
    },
  },
}
