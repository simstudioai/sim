import type { ToolConfig } from '@/tools/types'
import type { VercelUpdateEnvVarParams, VercelUpdateEnvVarResponse } from '@/tools/vercel/types'

export const vercelUpdateEnvVarTool: ToolConfig<
  VercelUpdateEnvVarParams,
  VercelUpdateEnvVarResponse
> = {
  id: 'vercel_update_env_var',
  name: 'Vercel Update Environment Variable',
  description: 'Update an environment variable for a Vercel project',
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
      description: 'Environment variable ID to update',
    },
    key: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New variable name',
    },
    value: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New variable value',
    },
    target: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of target environments (production, preview, development)',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Variable type: system, secret, encrypted, plain, or sensitive',
    },
    gitBranch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Git branch to associate with the variable (requires target to include preview)',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comment to add context to the variable (max 500 characters)',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelUpdateEnvVarParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v9/projects/${params.projectId.trim()}/env/${params.envId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'PATCH',
    headers: (params: VercelUpdateEnvVarParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: VercelUpdateEnvVarParams) => {
      const body: Record<string, unknown> = {}
      if (params.key) body.key = params.key
      if (params.value) body.value = params.value
      if (params.target) body.target = params.target.split(',').map((t) => t.trim())
      if (params.type) body.type = params.type
      if (params.gitBranch) body.gitBranch = params.gitBranch
      if (params.comment) body.comment = params.comment
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        key: data.key,
        value: data.value ?? '',
        type: data.type ?? 'plain',
        target: data.target ?? [],
        gitBranch: data.gitBranch ?? null,
        comment: data.comment ?? null,
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Environment variable ID',
    },
    key: {
      type: 'string',
      description: 'Variable name',
    },
    value: {
      type: 'string',
      description: 'Variable value',
    },
    type: {
      type: 'string',
      description: 'Variable type (secret, system, encrypted, plain, sensitive)',
    },
    target: {
      type: 'array',
      description: 'Target environments',
      items: { type: 'string', description: 'Environment name' },
    },
    gitBranch: {
      type: 'string',
      description: 'Git branch filter',
      optional: true,
    },
    comment: {
      type: 'string',
      description: 'Comment providing context for the variable',
      optional: true,
    },
  },
}
