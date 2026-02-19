import type { ToolConfig } from '@/tools/types'
import type { VercelCreateAliasParams, VercelCreateAliasResponse } from '@/tools/vercel/types'

export const vercelCreateAliasTool: ToolConfig<VercelCreateAliasParams, VercelCreateAliasResponse> =
  {
    id: 'vercel_create_alias',
    name: 'Vercel Create Alias',
    description: 'Assign an alias (domain/subdomain) to a deployment',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Vercel Access Token',
      },
      deploymentId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Deployment ID to assign the alias to',
      },
      alias: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The domain or subdomain to assign as an alias',
      },
      teamId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Team ID to scope the request',
      },
    },

    request: {
      url: (params: VercelCreateAliasParams) => {
        const query = new URLSearchParams()
        if (params.teamId) query.set('teamId', params.teamId.trim())
        const qs = query.toString()
        return `https://api.vercel.com/v2/deployments/${params.deploymentId.trim()}/aliases${qs ? `?${qs}` : ''}`
      },
      method: 'POST',
      headers: (params: VercelCreateAliasParams) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: (params: VercelCreateAliasParams) => ({
        alias: params.alias.trim(),
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      return {
        success: true,
        output: {
          uid: data.uid ?? null,
          alias: data.alias ?? null,
          created: data.created ?? null,
          oldDeploymentId: data.oldDeploymentId ?? null,
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
      created: {
        type: 'string',
        description: 'Creation timestamp as ISO 8601 date-time string',
      },
      oldDeploymentId: {
        type: 'string',
        description: 'ID of the previously aliased deployment, if the alias was reassigned',
      },
    },
  }
