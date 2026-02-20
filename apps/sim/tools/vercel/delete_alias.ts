import type { ToolConfig } from '@/tools/types'
import type { VercelDeleteAliasParams, VercelDeleteAliasResponse } from '@/tools/vercel/types'

export const vercelDeleteAliasTool: ToolConfig<VercelDeleteAliasParams, VercelDeleteAliasResponse> =
  {
    id: 'vercel_delete_alias',
    name: 'Vercel Delete Alias',
    description: 'Delete an alias by its ID',
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
        description: 'Alias ID to delete',
      },
      teamId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Team ID to scope the request',
      },
    },

    request: {
      url: (params: VercelDeleteAliasParams) => {
        const query = new URLSearchParams()
        if (params.teamId) query.set('teamId', params.teamId.trim())
        const qs = query.toString()
        return `https://api.vercel.com/v2/aliases/${params.aliasId.trim()}${qs ? `?${qs}` : ''}`
      },
      method: 'DELETE',
      headers: (params: VercelDeleteAliasParams) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      return {
        success: true,
        output: {
          status: data.status ?? 'SUCCESS',
        },
      }
    },

    outputs: {
      status: {
        type: 'string',
        description: 'Deletion status (SUCCESS)',
      },
    },
  }
