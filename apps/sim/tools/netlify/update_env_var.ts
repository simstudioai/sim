import type { NetlifyUpdateEnvVarParams, NetlifyUpdateEnvVarResponse } from '@/tools/netlify/types'
import { buildEnvBody, type NetlifyApiEnvVar, normalizeEnvVar } from '@/tools/netlify/utils'
import type { ToolConfig } from '@/tools/types'

export const netlifyUpdateEnvVarTool: ToolConfig<
  NetlifyUpdateEnvVarParams,
  NetlifyUpdateEnvVarResponse
> = {
  id: 'netlify_update_env_var',
  name: 'Netlify Update Environment Variable',
  description: 'Replace an environment variable for an account, optionally scoped to a site',
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
      description: 'Optional site ID to scope the variable to a specific site',
    },
    key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Variable name to update',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New variable value (replaces all existing values)',
    },
    context: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Deploy context: all, production, deploy-preview, branch-deploy, dev (default: all)',
    },
    scopes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated scopes (builds, functions, runtime, post_processing)',
    },
    isSecret: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mark the value as secret ("true" or "false")',
    },
  },

  request: {
    url: (params: NetlifyUpdateEnvVarParams) => {
      const query = new URLSearchParams()
      if (params.siteId) query.set('site_id', params.siteId.trim())
      const qs = query.toString()
      return `https://api.netlify.com/api/v1/accounts/${encodeURIComponent(params.accountId.trim())}/env/${encodeURIComponent(params.key.trim())}${qs ? `?${qs}` : ''}`
    },
    method: 'PUT',
    headers: (params: NetlifyUpdateEnvVarParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: NetlifyUpdateEnvVarParams) => buildEnvBody(params),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as NetlifyApiEnvVar

    return {
      success: true,
      output: {
        envVar: normalizeEnvVar(data ?? {}),
      },
    }
  },

  outputs: {
    envVar: {
      type: 'object',
      description: 'Updated environment variable',
      properties: {
        key: { type: 'string', description: 'Variable name' },
        scopes: {
          type: 'array',
          description: 'Scopes',
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
                description: 'Branch name for branch-deploy context',
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
}
