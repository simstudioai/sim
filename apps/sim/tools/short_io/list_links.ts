import type { ShortIoListLinksParams } from '@/tools/short_io/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const shortIoListLinksTool: ToolConfig<ShortIoListLinksParams, ToolResponse> = {
  id: 'short_io_list_links',
  name: 'Short.io List Links',
  description:
    'List short links for a domain. Requires domain_id (from List Domains or dashboard). Max 150 per request.',
  version: '1.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Short.io Secret API Key',
    },
    domainId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Domain ID (from List Domains)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max links to return (1–150)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from previous response',
    },
    dateSortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by date: asc or desc',
    },
  },
  request: {
    url: (params) => {
      const u = new URL('https://api.short.io/api/links')
      u.searchParams.set('domain_id', String(params.domainId))
      if (params.limit != null && params.limit >= 1 && params.limit <= 150) {
        u.searchParams.set('limit', String(params.limit))
      }
      if (params.pageToken) u.searchParams.set('pageToken', params.pageToken)
      if (params.dateSortOrder === 'asc' || params.dateSortOrder === 'desc') {
        u.searchParams.set('dateSortOrder', params.dateSortOrder)
      }
      return u.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: params.apiKey,
      Accept: 'application/json',
    }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const err = await response.text().catch(() => response.statusText)
      return { success: false, output: { success: false, error: err } }
    }
    const data = await response.json().catch(() => ({}))
    const links = data.links ?? []
    const count = data.count ?? links.length
    return {
      success: true,
      output: {
        success: true,
        links,
        count,
        nextPageToken: data.nextPageToken ?? undefined,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    links: {
      type: 'array',
      description: 'List of link objects (idString, shortURL, originalURL, path, etc.)',
    },
    count: { type: 'number', description: 'Number of links returned' },
    nextPageToken: { type: 'string', description: 'Token for next page' },
    error: { type: 'string', description: 'Error message' },
  },
}
