import type {
  AhrefsBrokenBacklinksParams,
  AhrefsBrokenBacklinksResponse,
} from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

export const brokenBacklinksTool: ToolConfig<
  AhrefsBrokenBacklinksParams,
  AhrefsBrokenBacklinksResponse
> = {
  id: 'ahrefs_broken_backlinks',
  name: 'Ahrefs Broken Backlinks',
  description:
    'Get a list of broken backlinks pointing to a target domain or URL. Useful for identifying link reclamation opportunities.',
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
        'Analysis mode: domain (entire domain), prefix (URL prefix), subdomains (include all subdomains), exact (exact URL match). Example: "domain"',
    },
    date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Date for historical data in YYYY-MM-DD format (defaults to today)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return. Example: 50 (default: 100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip for pagination. Example: 100',
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
      const url = new URL('https://api.ahrefs.com/v3/site-explorer/broken-backlinks')
      url.searchParams.set('target', params.target)
      // Date is required - default to today if not provided
      const date = params.date || new Date().toISOString().split('T')[0]
      url.searchParams.set('date', date)
      if (params.mode) url.searchParams.set('mode', params.mode)
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      if (params.offset) url.searchParams.set('offset', String(params.offset))
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
      throw new Error(data.error?.message || data.error || 'Failed to get broken backlinks')
    }

    const brokenBacklinks = (data.backlinks || data.broken_backlinks || []).map((link: any) => ({
      urlFrom: link.url_from || '',
      urlTo: link.url_to || '',
      httpCode: link.http_code ?? link.status_code ?? 404,
      anchor: link.anchor || '',
      domainRatingSource: link.domain_rating_source ?? link.domain_rating ?? 0,
    }))

    return {
      success: true,
      output: {
        brokenBacklinks,
      },
    }
  },

  outputs: {
    brokenBacklinks: {
      type: 'array',
      description: 'List of broken backlinks',
      items: {
        type: 'object',
        properties: {
          urlFrom: {
            type: 'string',
            description: 'The URL of the page containing the broken link',
          },
          urlTo: { type: 'string', description: 'The broken URL being linked to' },
          httpCode: { type: 'number', description: 'HTTP status code (e.g., 404, 410)' },
          anchor: { type: 'string', description: 'The anchor text of the link' },
          domainRatingSource: {
            type: 'number',
            description: 'Domain Rating of the linking domain',
          },
        },
      },
    },
  },
}
