import type { NetlifyDeleteEnvVarParams, NetlifyDeleteEnvVarResponse } from '@/tools/netlify/types'
import type { ToolConfig } from '@/tools/types'

export const netlifyDeleteEnvVarTool: ToolConfig<
  NetlifyDeleteEnvVarParams,
  NetlifyDeleteEnvVarResponse
> = {
  id: 'netlify_delete_env_var',
  name: 'Netlify Delete Environment Variable',
  description: 'Delete an environment variable from an account, optionally scoped to a site',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Netlify Personal Access Token',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account ID or slug that owns the variable',
    },
    siteId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional site ID to scope deletion to a specific site',
    },
    key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Variable name to delete',
    },
  },

  request: {
    url: (params: NetlifyDeleteEnvVarParams) => {
      const query = new URLSearchParams()
      if (params.siteId) query.set('site_id', params.siteId.trim())
      const qs = query.toString()
      return `https://api.netlify.com/api/v1/accounts/${encodeURIComponent(params.accountId.trim())}/env/${encodeURIComponent(params.key.trim())}${qs ? `?${qs}` : ''}`
    },
    method: 'DELETE',
    headers: (params: NetlifyDeleteEnvVarParams) => ({
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
      description: 'Whether the environment variable was deleted',
    },
  },
}
