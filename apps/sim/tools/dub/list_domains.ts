import type { DubListDomainsParams, DubListDomainsResponse } from '@/tools/dub/types'
import type { ToolConfig } from '@/tools/types'

export const listDomainsTool: ToolConfig<DubListDomainsParams, DubListDomainsResponse> = {
  id: 'dub_list_domains',
  name: 'Dub List Domains',
  description:
    'Retrieve the custom domains registered in the workspace, so links can be created against the right domain.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dub API key',
    },
    archived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include archived domains (defaults to false)',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search by domain name',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (default: 1)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of domains per page (default: 50, max: 50)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.dub.co/domains')
      if (params.archived !== undefined) url.searchParams.set('archived', String(params.archived))
      if (params.search) url.searchParams.set('search', params.search)
      if (params.page) url.searchParams.set('page', String(params.page))
      if (params.pageSize) url.searchParams.set('pageSize', String(params.pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.error || 'Failed to list domains')
    }

    const domains = Array.isArray(data) ? (data as Record<string, unknown>[]) : []

    return {
      success: true,
      output: {
        domains,
        count: domains.length,
      },
    }
  },

  outputs: {
    domains: {
      type: 'json',
      description: 'Array of domain objects (slug, verified, primary, archived)',
    },
    count: { type: 'number', description: 'Number of domains returned' },
  },
}
