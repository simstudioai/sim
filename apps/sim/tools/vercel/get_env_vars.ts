import type { ToolConfig } from '@/tools/types'
import type { VercelGetEnvVarsParams, VercelGetEnvVarsResponse } from '@/tools/vercel/types'

export const vercelGetEnvVarsTool: ToolConfig<VercelGetEnvVarsParams, VercelGetEnvVarsResponse> = {
  id: 'vercel_get_env_vars',
  name: 'Vercel Get Environment Variables',
  description: 'Retrieve environment variables for a Vercel project',
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
    decrypt: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'If true, decrypted variable values are returned instead of ciphertext',
    },
    gitBranch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter results to the environment variables for this git branch (must have target=preview)',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
    slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team slug to scope the request (alternative to teamId)',
    },
  },

  request: {
    url: (params: VercelGetEnvVarsParams) => {
      const query = new URLSearchParams()
      if (params.decrypt) query.set('decrypt', 'true')
      if (params.gitBranch) query.set('gitBranch', params.gitBranch.trim())
      if (params.teamId) query.set('teamId', params.teamId.trim())
      if (params.slug) query.set('slug', params.slug.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v10/projects/${params.projectId.trim()}/env${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelGetEnvVarsParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const envs = (data.envs ?? []).map((e: any) => ({
      id: e.id,
      key: e.key,
      value: e.value ?? '',
      type: e.type ?? 'plain',
      target: e.target ?? [],
      gitBranch: e.gitBranch ?? null,
      comment: e.comment ?? null,
      createdAt: e.createdAt ?? null,
      updatedAt: e.updatedAt ?? null,
    }))

    return {
      success: true,
      output: {
        envs,
        count: envs.length,
      },
    }
  },

  outputs: {
    envs: {
      type: 'array',
      description: 'List of environment variables',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Environment variable ID' },
          key: { type: 'string', description: 'Variable name' },
          value: { type: 'string', description: 'Variable value' },
          type: {
            type: 'string',
            description: 'Variable type (secret, system, encrypted, plain, sensitive)',
          },
          target: {
            type: 'array',
            description: 'Target environments',
            items: { type: 'string', description: 'Environment name' },
          },
          gitBranch: { type: 'string', description: 'Git branch filter', optional: true },
          comment: {
            type: 'string',
            description: 'Comment providing context for the variable',
            optional: true,
          },
          createdAt: { type: 'number', description: 'Creation timestamp', optional: true },
          updatedAt: { type: 'number', description: 'Last update timestamp', optional: true },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of environment variables returned',
    },
  },
}
