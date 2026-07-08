import type { AhrefsAnchorsParams, AhrefsAnchorsResponse } from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

const SELECT_FIELDS = 'anchor,links_to_target,dofollow_links,refdomains,first_seen,last_seen'

export const anchorsTool: ToolConfig<AhrefsAnchorsParams, AhrefsAnchorsResponse> = {
  id: 'ahrefs_anchors',
  name: 'Ahrefs Anchors',
  description:
    "Get the anchor text distribution for a target domain or URL's backlinks, showing how many links and referring domains use each anchor text.",
  version: '1.0.0',

  params: {
    target: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The target domain or URL to analyze. Example: "example.com" or "https://example.com/page"',
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Analysis mode: domain (entire domain), prefix (URL prefix), subdomains (include all subdomains, default), exact (exact URL match)',
    },
    history: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Historical scope: "live" (currently live), "all_time" (default, includes lost backlinks), or "since:YYYY-MM-DD" (backlinks found since a date)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return. Example: 50 (default: 1000)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ahrefs API Key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.ahrefs.com/v3/site-explorer/anchors')
      url.searchParams.set('target', params.target)
      url.searchParams.set('select', SELECT_FIELDS)
      if (params.mode) url.searchParams.set('mode', params.mode)
      url.searchParams.set('history', params.history || 'all_time')
      if (params.limit) url.searchParams.set('limit', String(params.limit))
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
      throw new Error(data.error?.message || data.error || 'Failed to get anchors')
    }

    const anchors = (data.anchors || []).map((item: any) => ({
      anchor: item.anchor || '',
      backlinks: item.links_to_target ?? 0,
      dofollowBacklinks: item.dofollow_links ?? 0,
      referringDomains: item.refdomains ?? 0,
      firstSeen: item.first_seen || '',
      lastSeen: item.last_seen ?? null,
    }))

    return {
      success: true,
      output: {
        anchors,
      },
    }
  },

  outputs: {
    anchors: {
      type: 'array',
      description: 'Anchor text distribution for the backlink profile',
      items: {
        type: 'object',
        properties: {
          anchor: { type: 'string', description: 'The anchor text' },
          backlinks: { type: 'number', description: 'Total backlinks using this anchor text' },
          dofollowBacklinks: {
            type: 'number',
            description: 'Number of dofollow backlinks using this anchor text',
          },
          referringDomains: {
            type: 'number',
            description: 'Number of unique referring domains using this anchor text',
          },
          firstSeen: {
            type: 'string',
            description: 'When a link with this anchor was first found',
          },
          lastSeen: {
            type: 'string',
            description: 'When a backlink with this anchor was last seen (null if still live)',
            optional: true,
          },
        },
      },
    },
  },
}
