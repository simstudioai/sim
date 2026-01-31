import type { AhrefsBacklinksStatsParams, AhrefsBacklinksStatsResponse } from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

export const backlinksStatsTool: ToolConfig<
  AhrefsBacklinksStatsParams,
  AhrefsBacklinksStatsResponse
> = {
  id: 'ahrefs_backlinks_stats',
  name: 'Ahrefs Backlinks Stats',
  description:
    'Get backlink statistics for a target domain or URL. Returns totals for different backlink types including dofollow, nofollow, text, image, and redirect links.',
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

    return {
      success: true,
      output: {
        stats: {
          total: data.live ?? data.total ?? 0,
          dofollow: data.live_dofollow ?? data.dofollow ?? 0,
          nofollow: data.live_nofollow ?? data.nofollow ?? 0,
          text: data.text ?? 0,
          image: data.image ?? 0,
          redirect: data.redirect ?? 0,
        },
      },
    }
  },

  outputs: {
    stats: {
      type: 'object',
      description: 'Backlink statistics summary',
      properties: {
        total: { type: 'number', description: 'Total number of live backlinks' },
        dofollow: { type: 'number', description: 'Number of dofollow backlinks' },
        nofollow: { type: 'number', description: 'Number of nofollow backlinks' },
        text: { type: 'number', description: 'Number of text backlinks' },
        image: { type: 'number', description: 'Number of image backlinks' },
        redirect: { type: 'number', description: 'Number of redirect backlinks' },
      },
    },
  },
}
