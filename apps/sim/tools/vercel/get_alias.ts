import type { ToolConfig } from '@/tools/types'
import type { VercelGetAliasParams, VercelGetAliasResponse } from '@/tools/vercel/types'

export const vercelGetAliasTool: ToolConfig<VercelGetAliasParams, VercelGetAliasResponse> = {
  id: 'vercel_get_alias',
  name: 'Vercel Get Alias',
  description: 'Get details about a specific alias by ID or hostname',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    aliasId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Alias ID or hostname to look up',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelGetAliasParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v4/aliases/${params.aliasId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelGetAliasParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        uid: data.uid ?? null,
        alias: data.alias ?? null,
        deploymentId: data.deploymentId ?? null,
        projectId: data.projectId ?? null,
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
        redirect: data.redirect ?? null,
        redirectStatusCode: data.redirectStatusCode ?? null,
      },
    }
  },

  outputs: {
    uid: {
      type: 'string',
      description: 'Alias ID',
    },
    alias: {
      type: 'string',
      description: 'Alias hostname',
    },
    deploymentId: {
      type: 'string',
      description: 'Associated deployment ID',
    },
    projectId: {
      type: 'string',
      description: 'Associated project ID',
    },
    createdAt: {
      type: 'number',
      description: 'Creation timestamp in milliseconds',
    },
    updatedAt: {
      type: 'number',
      description: 'Last update timestamp in milliseconds',
    },
    redirect: {
      type: 'string',
      description: 'Target domain for redirect aliases',
    },
    redirectStatusCode: {
      type: 'number',
      description: 'HTTP status code for redirect (301, 302, 307, or 308)',
    },
  },
}
