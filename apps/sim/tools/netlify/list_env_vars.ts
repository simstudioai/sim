import type { NetlifyListEnvVarsParams, NetlifyListEnvVarsResponse } from '@/tools/netlify/types'
import { type NetlifyApiEnvVar, normalizeEnvVar } from '@/tools/netlify/utils'
import type { ToolConfig } from '@/tools/types'

export const netlifyListEnvVarsTool: ToolConfig<
  NetlifyListEnvVarsParams,
  NetlifyListEnvVarsResponse
> = {
  id: 'netlify_list_env_vars',
  name: 'Netlify List Environment Variables',
  description: 'List environment variables for an account, optionally scoped to a site',
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
      description: 'Account ID or slug that owns the environment variables',
    },
    siteId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional site ID to scope variables to a specific site',
    },
    contextName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by deploy context (production, deploy-preview, branch-deploy, dev)',
    },
    scope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by scope (builds, functions, runtime, post_processing)',
    },
  },

  request: {
    url: (params: NetlifyListEnvVarsParams) => {
      const query = new URLSearchParams()
      if (params.siteId) query.set('site_id', params.siteId.trim())
      if (params.contextName) query.set('context_name', params.contextName.trim())
      if (params.scope) query.set('scope', params.scope.trim())
      const qs = query.toString()
      return `https://api.netlify.com/api/v1/accounts/${encodeURIComponent(params.accountId.trim())}/env${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: NetlifyListEnvVarsParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as NetlifyApiEnvVar[]
    const envVars = (Array.isArray(data) ? data : []).map(normalizeEnvVar)

    return {
      success: true,
      output: {
        envVars,
        count: envVars.length,
      },
    }
  },

  outputs: {
    envVars: {
      type: 'array',
      description: 'List of environment variables',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name' },
          scopes: {
            type: 'array',
            description: 'Where the variable applies (builds, functions, runtime, post_processing)',
            items: { type: 'string', description: 'Scope name' },
          },
          values: {
            type: 'array',
            description: 'Per-context values',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Value ID', optional: true },
                context: { type: 'string', description: 'Context name', optional: true },
                contextParameter: {
                  type: 'string',
                  description: 'Branch name when context is branch-deploy',
                  optional: true,
                },
                value: { type: 'string', description: 'Variable value' },
              },
            },
          },
          isSecret: { type: 'boolean', description: 'Whether the value is secret' },
          updatedAt: { type: 'string', description: 'Last update timestamp', optional: true },
        },
      },
    },
    count: { type: 'number', description: 'Number of variables returned' },
  },
}
