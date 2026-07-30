import type { AhrefsBacklinksStatsParams, AhrefsBacklinksStatsResponse } from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

export const backlinksStatsTool: ToolConfig<
  AhrefsBacklinksStatsParams,
  AhrefsBacklinksStatsResponse
> = {
  id: 'ahrefs_backlinks_stats',
  name: 'Ahrefs Backlinks Stats',
  description:
    'Get backlink and referring domain totals for a target domain or URL, both currently live and across all time.',
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
    date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Date to report metrics on, in YYYY-MM-DD format (defaults to today)',
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
      const url = new URL('https://api.ahrefs.com/v3/site-explorer/backlinks-stats')
      url.searchParams.set('target', params.target)
      // Date is required - default to today if not provided
      const date = params.date || new Date().toISOString().split('T')[0]
      url.searchParams.set('date', date)
      if (params.mode) url.searchParams.set('mode', params.mode)
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
      throw new Error(data.error?.message || data.error || 'Failed to get backlinks stats')
    }

    const metrics = data.metrics || {}

    return {
      success: true,
      output: {
        stats: {
          liveBacklinks: metrics.live ?? 0,
          liveReferringDomains: metrics.live_refdomains ?? 0,
          allTimeBacklinks: metrics.all_time ?? 0,
          allTimeReferringDomains: metrics.all_time_refdomains ?? 0,
        },
      },
    }
  },

  outputs: {
    stats: {
      type: 'object',
      description: 'Backlink and referring domain totals',
      properties: {
        liveBacklinks: { type: 'number', description: 'Number of currently live backlinks' },
        liveReferringDomains: {
          type: 'number',
          description: 'Number of currently live referring domains',
        },
        allTimeBacklinks: {
          type: 'number',
          description: 'Total backlinks ever discovered, including lost ones',
        },
        allTimeReferringDomains: {
          type: 'number',
          description: 'Total referring domains ever discovered, including lost ones',
        },
      },
    },
  },
}
