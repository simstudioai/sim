import type { ToolConfig } from '@/tools/types'
import type { VercelListAliasesParams, VercelListAliasesResponse } from '@/tools/vercel/types'

export const vercelListAliasesTool: ToolConfig<VercelListAliasesParams, VercelListAliasesResponse> =
  {
    id: 'vercel_list_aliases',
    name: 'Vercel List Aliases',
    description: 'List aliases for a Vercel project or team',
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
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter aliases by project ID',
      },
      domain: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter aliases by domain',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of aliases to return',
      },
      teamId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Team ID to scope the request',
      },
    },

    request: {
      url: (params: VercelListAliasesParams) => {
        const query = new URLSearchParams()
        if (params.projectId) query.set('projectId', params.projectId.trim())
        if (params.domain) query.set('domain', params.domain.trim())
        if (params.limit) query.set('limit', String(params.limit))
        if (params.teamId) query.set('teamId', params.teamId.trim())
        const qs = query.toString()
        return `https://api.vercel.com/v4/aliases${qs ? `?${qs}` : ''}`
      },
      method: 'GET',
      headers: (params: VercelListAliasesParams) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      const aliases = (data.aliases ?? []).map((a: any) => ({
        uid: a.uid ?? null,
        alias: a.alias ?? null,
        deploymentId: a.deploymentId ?? null,
        projectId: a.projectId ?? null,
        createdAt: a.createdAt ?? null,
        updatedAt: a.updatedAt ?? null,
      }))

      return {
        success: true,
        output: {
          aliases,
          count: aliases.length,
          hasMore: data.pagination?.next != null,
        },
      }
    },

    outputs: {
      aliases: {
        type: 'array',
        description: 'List of aliases',
        items: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'Alias ID' },
            alias: { type: 'string', description: 'Alias hostname' },
            deploymentId: { type: 'string', description: 'Associated deployment ID' },
            projectId: { type: 'string', description: 'Associated project ID' },
            createdAt: { type: 'number', description: 'Creation timestamp in milliseconds' },
            updatedAt: { type: 'number', description: 'Last update timestamp in milliseconds' },
          },
        },
      },
      count: {
        type: 'number',
        description: 'Number of aliases returned',
      },
      hasMore: {
        type: 'boolean',
        description: 'Whether more aliases are available',
      },
    },
  }
