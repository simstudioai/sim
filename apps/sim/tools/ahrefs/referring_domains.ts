import type {
  AhrefsReferringDomainsParams,
  AhrefsReferringDomainsResponse,
} from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

const SELECT_FIELDS = 'domain,domain_rating,links_to_target,dofollow_links,first_seen,last_seen'

export const referringDomainsTool: ToolConfig<
  AhrefsReferringDomainsParams,
  AhrefsReferringDomainsResponse
> = {
  id: 'ahrefs_referring_domains',
  name: 'Ahrefs Referring Domains',
  description:
    'Get a list of domains that link to a target domain or URL. Returns unique referring domains with their domain rating, backlink counts, and discovery dates.',
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
        'Historical scope: "live" (currently live), "all_time" (default, includes lost domains), or "since:YYYY-MM-DD" (domains found since a date).',
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
      const url = new URL('https://api.ahrefs.com/v3/site-explorer/refdomains')
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
      throw new Error(data.error?.message || data.error || 'Failed to get referring domains')
    }

    const referringDomains = (data.refdomains || []).map((domain: any) => ({
      domain: domain.domain || '',
      domainRating: domain.domain_rating ?? 0,
      backlinks: domain.links_to_target ?? 0,
      dofollowBacklinks: domain.dofollow_links ?? 0,
      firstSeen: domain.first_seen || '',
      lastVisited: domain.last_seen ?? null,
    }))

    return {
      success: true,
      output: {
        referringDomains,
      },
    }
  },

  outputs: {
    referringDomains: {
      type: 'array',
      description: 'List of domains linking to the target',
      items: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'The referring domain' },
          domainRating: { type: 'number', description: 'Domain Rating of the referring domain' },
          backlinks: {
            type: 'number',
            description: 'Total number of backlinks from this domain to the target',
          },
          dofollowBacklinks: {
            type: 'number',
            description: 'Number of dofollow backlinks from this domain',
          },
          firstSeen: { type: 'string', description: 'When the domain was first seen linking' },
          lastVisited: {
            type: 'string',
            description: 'When the domain was last seen linking (null if never re-crawled)',
            optional: true,
          },
        },
      },
    },
  },
}
