import type { DubGetLinksCountParams, DubGetLinksCountResponse } from '@/tools/dub/types'
import type { ToolConfig } from '@/tools/types'

export const getLinksCountTool: ToolConfig<DubGetLinksCountParams, DubGetLinksCountResponse> = {
  id: 'dub_get_links_count',
  name: 'Dub Count Links',
  description:
    'Retrieve the number of short links for the authenticated workspace, optionally filtered and grouped by domain, tag, user, or folder.',
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
    tagNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tag names to filter by (case-insensitive)',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by folder ID',
    },
    showArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include archived links (defaults to false)',
    },
    groupBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Group counts by: domain, tagId, userId, or folderId',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.dub.co/links/count')
      if (params.domain) url.searchParams.set('domain', params.domain)
      if (params.search) url.searchParams.set('search', params.search)
      if (params.tagIds) url.searchParams.set('tagIds', params.tagIds)
      if (params.tagNames) url.searchParams.set('tagNames', params.tagNames)
      if (params.folderId) url.searchParams.set('folderId', params.folderId)
      if (params.showArchived !== undefined)
        url.searchParams.set('showArchived', String(params.showArchived))
      if (params.groupBy) url.searchParams.set('groupBy', params.groupBy)
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
      throw new Error(data.error?.message || data.error || 'Failed to count links')
    }

    if (typeof data === 'number') {
      return {
        success: true,
        output: {
          count: data,
          groups: null,
        },
      }
    }

    const groups = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
    const count = groups.reduce((sum, group) => sum + (Number(group.count) || 0), 0)

    return {
      success: true,
      output: {
        count,
        groups,
      },
    }
  },

  outputs: {
    count: { type: 'number', description: 'Total number of links matching the filters' },
    groups: {
      type: 'json',
      description: 'Per-group counts when groupBy is set (e.g. [{ domain, count }])',
      optional: true,
    },
  },
}
