import type { NetlifyListDeploysParams, NetlifyListDeploysResponse } from '@/tools/netlify/types'
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

export const netlifyListDeploysTool: ToolConfig<
  NetlifyListDeploysParams,
  NetlifyListDeploysResponse
> = {
  id: 'netlify_list_deploys',
  name: 'Netlify List Deploys',
  description: 'List deploys for a Netlify site',
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
      description: 'Site ID or primary domain',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by deploy state: ready, error, building, enqueued, processing, uploading, new',
    },
    branch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by git branch',
    },
    production: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter to production deploys only ("true" or "false")',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (1-indexed)',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (max 100)',
    },
  },

  request: {
    url: (params: NetlifyListDeploysParams) => {
      const query = new URLSearchParams()
      if (params.state) query.set('state', params.state)
      if (params.branch) query.set('branch', params.branch.trim())
      if (params.production) query.set('production', params.production)
      if (params.page) query.set('page', String(params.page))
      if (params.perPage) query.set('per_page', String(params.perPage))
      const qs = query.toString()
      return `https://api.netlify.com/api/v1/sites/${encodeURIComponent(params.siteId.trim())}/deploys${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: NetlifyListDeploysParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as NetlifyApiDeploy[]
    const deploys = (Array.isArray(data) ? data : []).map((d) => ({
      id: d.id ?? '',
      siteId: d.site_id ?? null,
      state: d.state ?? 'unknown',
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
    }))

    return {
      success: true,
      output: {
        deploys,
        count: deploys.length,
      },
    }
  },

  outputs: {
    deploys: {
      type: 'array',
      description: 'List of deploys',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Deploy ID' },
          siteId: { type: 'string', description: 'Site ID', optional: true },
          state: {
            type: 'string',
            description:
              'Deploy state: new, enqueued, building, uploading, processing, ready, error, retrying',
          },
          name: { type: 'string', description: 'Site name', optional: true },
          url: { type: 'string', description: 'Site URL', optional: true },
          deployUrl: { type: 'string', description: 'Unique deploy URL', optional: true },
          deploySslUrl: { type: 'string', description: 'Unique deploy HTTPS URL', optional: true },
          adminUrl: { type: 'string', description: 'Netlify admin URL', optional: true },
          branch: { type: 'string', description: 'Git branch', optional: true },
          context: {
            type: 'string',
            description: 'Deploy context: production, deploy-preview, branch-deploy',
            optional: true,
          },
          commitRef: { type: 'string', description: 'Git commit SHA', optional: true },
          commitUrl: { type: 'string', description: 'Git commit URL', optional: true },
          errorMessage: { type: 'string', description: 'Error message if failed', optional: true },
          createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
          updatedAt: { type: 'string', description: 'Last update timestamp', optional: true },
          publishedAt: { type: 'string', description: 'Publish timestamp', optional: true },
        },
      },
    },
    count: { type: 'number', description: 'Number of deploys returned' },
  },
}
