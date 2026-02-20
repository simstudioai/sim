import type { ToolConfig } from '@/tools/types'
import type { VercelCreateEnvVarParams, VercelCreateEnvVarResponse } from '@/tools/vercel/types'

export const vercelCreateEnvVarTool: ToolConfig<
  VercelCreateEnvVarParams,
  VercelCreateEnvVarResponse
> = {
  id: 'vercel_create_env_var',
  name: 'Vercel Create Environment Variable',
  description: 'Create an environment variable for a Vercel project',
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
    key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Environment variable name',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Environment variable value',
    },
    target: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of target environments (production, preview, development)',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Variable type: system, secret, encrypted, plain, or sensitive (default: plain)',
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
    url: (params: VercelCreateEnvVarParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v10/projects/${params.projectId.trim()}/env${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params: VercelCreateEnvVarParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: VercelCreateEnvVarParams) => {
      const body: Record<string, unknown> = {
        key: params.key,
        value: params.value,
        target: params.target.split(',').map((t) => t.trim()),
        type: params.type || 'plain',
      }
      if (params.gitBranch) body.gitBranch = params.gitBranch
      if (params.comment) body.comment = params.comment
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const env = data.created ?? data
    return {
      success: true,
      output: {
        id: env.id,
        key: env.key,
        value: env.value ?? '',
        type: env.type ?? 'plain',
        target: env.target ?? [],
        gitBranch: env.gitBranch ?? null,
        comment: env.comment ?? null,
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
