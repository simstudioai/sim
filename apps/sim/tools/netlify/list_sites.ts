import type { NetlifyListSitesParams, NetlifyListSitesResponse } from '@/tools/netlify/types'
import type { ToolConfig } from '@/tools/types'

interface NetlifyApiSite {
  id?: string
  name?: string
  url?: string
  ssl_url?: string
  admin_url?: string
  custom_domain?: string
  account_id?: string
  account_slug?: string
  created_at?: string
  updated_at?: string
}

export const netlifyListSitesTool: ToolConfig<NetlifyListSitesParams, NetlifyListSitesResponse> = {
  id: 'netlify_list_sites',
  name: 'Netlify List Sites',
  description: 'List Netlify sites accessible to the authenticated user',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Netlify Personal Access Token',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter sites by name',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter scope: all, owner, or guest',
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
    url: (params: NetlifyListSitesParams) => {
      const query = new URLSearchParams()
      if (params.name) query.set('name', params.name.trim())
      if (params.filter) query.set('filter', params.filter)
      if (params.page) query.set('page', String(params.page))
      if (params.perPage) query.set('per_page', String(params.perPage))
      const qs = query.toString()
      return `https://api.netlify.com/api/v1/sites${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: NetlifyListSitesParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as NetlifyApiSite[]
    const sites = (Array.isArray(data) ? data : []).map((s) => ({
      id: s.id ?? '',
      name: s.name ?? null,
      url: s.url ?? null,
      sslUrl: s.ssl_url ?? null,
      adminUrl: s.admin_url ?? null,
      customDomain: s.custom_domain ?? null,
      accountId: s.account_id ?? null,
      accountSlug: s.account_slug ?? null,
      createdAt: s.created_at ?? null,
      updatedAt: s.updated_at ?? null,
    }))

    return {
      success: true,
      output: {
        sites,
        count: sites.length,
      },
    }
  },

  outputs: {
    sites: {
      type: 'array',
      description: 'List of Netlify sites',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Site ID' },
          name: { type: 'string', description: 'Site name', optional: true },
          url: { type: 'string', description: 'Primary site URL', optional: true },
          sslUrl: { type: 'string', description: 'HTTPS site URL', optional: true },
          adminUrl: { type: 'string', description: 'Netlify admin URL', optional: true },
          customDomain: { type: 'string', description: 'Custom domain', optional: true },
          accountId: { type: 'string', description: 'Owning account ID', optional: true },
          accountSlug: { type: 'string', description: 'Owning account slug', optional: true },
          createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
          updatedAt: { type: 'string', description: 'Last update timestamp', optional: true },
        },
      },
    },
    count: { type: 'number', description: 'Number of sites returned' },
  },
}
