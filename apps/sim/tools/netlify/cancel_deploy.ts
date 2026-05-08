import type { NetlifyCancelDeployParams, NetlifyCancelDeployResponse } from '@/tools/netlify/types'
import type { ToolConfig } from '@/tools/types'

interface NetlifyApiDeploy {
  id?: string
  site_id?: string
  state?: string
  name?: string
  url?: string
  deploy_url?: string
  deploy_ssl_url?: string
  admin_url?: string
  branch?: string
  context?: string
  commit_ref?: string
  commit_url?: string
  error_message?: string
  created_at?: string
  updated_at?: string
  published_at?: string
}

export const netlifyCancelDeployTool: ToolConfig<
  NetlifyCancelDeployParams,
  NetlifyCancelDeployResponse
> = {
  id: 'netlify_cancel_deploy',
  name: 'Netlify Cancel Deploy',
  description: 'Cancel an in-progress Netlify deploy',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Netlify Personal Access Token',
    },
    deployId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Deploy ID to cancel',
    },
  },

  request: {
    url: (params: NetlifyCancelDeployParams) =>
      `https://api.netlify.com/api/v1/deploys/${encodeURIComponent(params.deployId.trim())}/cancel`,
    method: 'POST',
    headers: (params: NetlifyCancelDeployParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const d = (await response.json()) as NetlifyApiDeploy

    return {
      success: true,
      output: {
        id: d.id ?? '',
        siteId: d.site_id ?? null,
        state: d.state ?? 'error',
        name: d.name ?? null,
        url: d.url ?? null,
        deployUrl: d.deploy_url ?? null,
        deploySslUrl: d.deploy_ssl_url ?? null,
        adminUrl: d.admin_url ?? null,
        branch: d.branch ?? null,
        context: d.context ?? null,
        commitRef: d.commit_ref ?? null,
        commitUrl: d.commit_url ?? null,
        errorMessage: d.error_message ?? null,
        createdAt: d.created_at ?? null,
        updatedAt: d.updated_at ?? null,
        publishedAt: d.published_at ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Deploy ID' },
    siteId: { type: 'string', description: 'Site ID', optional: true },
    state: { type: 'string', description: 'Deploy state after cancellation' },
    name: { type: 'string', description: 'Site name', optional: true },
    url: { type: 'string', description: 'Site URL', optional: true },
    deployUrl: { type: 'string', description: 'Unique deploy URL', optional: true },
    deploySslUrl: { type: 'string', description: 'Unique deploy HTTPS URL', optional: true },
    adminUrl: { type: 'string', description: 'Netlify admin URL', optional: true },
    branch: { type: 'string', description: 'Git branch', optional: true },
    context: { type: 'string', description: 'Deploy context', optional: true },
    commitRef: { type: 'string', description: 'Git commit SHA', optional: true },
    commitUrl: { type: 'string', description: 'Git commit URL', optional: true },
    errorMessage: { type: 'string', description: 'Error message if failed', optional: true },
    createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
    updatedAt: { type: 'string', description: 'Last update timestamp', optional: true },
    publishedAt: { type: 'string', description: 'Publish timestamp', optional: true },
  },
}
