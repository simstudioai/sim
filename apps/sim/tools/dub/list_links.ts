import type { DubListLinksParams, DubListLinksResponse } from '@/tools/dub/types'
import type { ToolConfig } from '@/tools/types'

export const listLinksTool: ToolConfig<DubListLinksParams, DubListLinksResponse> = {
  id: 'dub_list_links',
  name: 'Dub List Links',
  description:
    'Retrieve a paginated list of short links for the authenticated workspace. Supports filtering by domain, search query, tags, and sorting.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dub API key',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by domain',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query matched against the short link slug and destination URL',
    },
    tagIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tag IDs to filter by',
    },
    showArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include archived links (defaults to false)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by field: createdAt, clicks, saleAmount, or lastClicked',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: asc or desc',
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
      description: 'Number of links per page (default: 100, max: 100)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.dub.co/links')
      if (params.domain) url.searchParams.set('domain', params.domain)
      if (params.search) url.searchParams.set('search', params.search)
      if (params.tagIds) url.searchParams.set('tagIds', params.tagIds)
      if (params.showArchived !== undefined)
        url.searchParams.set('showArchived', String(params.showArchived))
      if (params.sortBy) url.searchParams.set('sortBy', params.sortBy)
      if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder)
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
      throw new Error(data.error?.message || data.error || 'Failed to list links')
    }

    const links = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        links: links.map((link: Record<string, unknown>) => ({
          id: (link.id as string) ?? '',
          domain: (link.domain as string) ?? '',
          key: (link.key as string) ?? '',
          url: (link.url as string) ?? '',
          shortLink: (link.shortLink as string) ?? '',
          qrCode: (link.qrCode as string) ?? '',
          archived: (link.archived as boolean) ?? false,
          externalId: (link.externalId as string) ?? null,
          title: (link.title as string) ?? null,
          description: (link.description as string) ?? null,
          clicks: (link.clicks as number) ?? 0,
          leads: (link.leads as number) ?? 0,
          sales: (link.sales as number) ?? 0,
          saleAmount: (link.saleAmount as number) ?? 0,
          lastClicked: (link.lastClicked as string) ?? null,
          createdAt: (link.createdAt as string) ?? '',
          updatedAt: (link.updatedAt as string) ?? '',
          tags: (link.tags as Array<{ id: string; name: string; color: string }>) ?? [],
          utm_source: (link.utm_source as string) ?? null,
          utm_medium: (link.utm_medium as string) ?? null,
          utm_campaign: (link.utm_campaign as string) ?? null,
          utm_term: (link.utm_term as string) ?? null,
          utm_content: (link.utm_content as string) ?? null,
        })),
        count: links.length,
      },
    }
  },

  outputs: {
    links: {
      type: 'json',
      description:
        'Array of link objects (id, domain, key, url, shortLink, clicks, tags, createdAt)',
    },
    count: {
      type: 'number',
      description: 'Number of links returned',
    },
  },
}
