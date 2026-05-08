import type { NetlifyCreateDeployParams, NetlifyCreateDeployResponse } from '@/tools/netlify/types'
import type { ToolConfig } from '@/tools/types'

interface NetlifyApiBuild {
  id?: string
  deploy_id?: string
  site_id?: string
  sha?: string
  done?: boolean
  error?: string
  created_at?: string
}

export const netlifyCreateDeployTool: ToolConfig<
  NetlifyCreateDeployParams,
  NetlifyCreateDeployResponse
> = {
  id: 'netlify_create_deploy',
  name: 'Netlify Create Deploy',
  description:
    'Trigger a new Netlify deploy by starting a build for a site (optionally from a specific branch)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Netlify Personal Access Token',
    },
    siteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Site ID or primary domain to deploy',
    },
    branch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Git branch to build from (defaults to the site’s configured production branch)',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional human-readable label shown in the deploy log',
    },
    clearCache: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Clear the build cache before deploying ("true" or "false")',
    },
  },

  request: {
    url: (params: NetlifyCreateDeployParams) => {
      const query = new URLSearchParams()
      if (params.branch) query.set('branch', params.branch.trim())
      if (params.title) query.set('title', params.title.trim())
      if (params.clearCache === 'true') query.set('clear_cache', 'true')
      const qs = query.toString()
      return `https://api.netlify.com/api/v1/sites/${encodeURIComponent(params.siteId.trim())}/builds${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params: NetlifyCreateDeployParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as NetlifyApiBuild

    return {
      success: true,
      output: {
        id: data.id ?? '',
        deployId: data.deploy_id ?? null,
        siteId: data.site_id ?? null,
        sha: data.sha ?? null,
        done: data.done ?? false,
        error: data.error ?? null,
        createdAt: data.created_at ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Build ID' },
    deployId: {
      type: 'string',
      description: 'Deploy ID produced by this build (use to poll status)',
      optional: true,
    },
    siteId: { type: 'string', description: 'Site ID', optional: true },
    sha: { type: 'string', description: 'Git commit SHA being built', optional: true },
    done: { type: 'boolean', description: 'Whether the build has completed' },
    error: { type: 'string', description: 'Build error if any', optional: true },
    createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  },
}
