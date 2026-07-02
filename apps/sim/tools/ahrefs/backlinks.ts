import type { AhrefsBacklinksParams, AhrefsBacklinksResponse } from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

const SELECT_FIELDS =
  'url_from,url_to,anchor,domain_rating_source,is_dofollow,first_seen,last_visited'

export const backlinksTool: ToolConfig<AhrefsBacklinksParams, AhrefsBacklinksResponse> = {
  id: 'ahrefs_backlinks',
  name: 'Ahrefs Backlinks',
  description:
    'Get a list of backlinks pointing to a target domain or URL. Returns details about each backlink including source URL, anchor text, and domain rating.',
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
        'Analysis mode: domain (entire domain), prefix (URL prefix), subdomains (include all subdomains, default), exact (exact URL match). Example: "domain"',
    },
    history: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Historical scope: "live" (currently live backlinks), "all_time" (default, includes lost backlinks), or "since:YYYY-MM-DD" (backlinks found since a date).',
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
      const url = new URL('https://api.ahrefs.com/v3/site-explorer/all-backlinks')
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
      throw new Error(data.error?.message || data.error || 'Failed to get backlinks')
    }

    const backlinks = (data.backlinks || []).map((link: any) => ({
      urlFrom: link.url_from || '',
      urlTo: link.url_to || '',
      anchor: link.anchor || '',
      domainRatingSource: link.domain_rating_source ?? 0,
      isDofollow: link.is_dofollow ?? false,
      firstSeen: link.first_seen || '',
      lastVisited: link.last_visited || '',
    }))

    return {
      success: true,
      output: {
        backlinks,
      },
    }
  },

  outputs: {
    backlinks: {
      type: 'array',
      description: 'List of backlinks pointing to the target',
      items: {
        type: 'object',
        properties: {
          urlFrom: { type: 'string', description: 'The URL of the page containing the backlink' },
          urlTo: { type: 'string', description: 'The URL being linked to' },
          anchor: { type: 'string', description: 'The anchor text of the link' },
          domainRatingSource: {
            type: 'number',
            description: 'Domain Rating of the linking domain',
          },
          isDofollow: { type: 'boolean', description: 'Whether the link is dofollow' },
          firstSeen: { type: 'string', description: 'When the backlink was first discovered' },
          lastVisited: { type: 'string', description: 'When the backlink was last checked' },
        },
      },
    },
  },
}
