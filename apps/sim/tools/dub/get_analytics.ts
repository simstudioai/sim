import type { DubGetAnalyticsParams, DubGetAnalyticsResponse } from '@/tools/dub/types'
import type { ToolConfig } from '@/tools/types'

export const getAnalyticsTool: ToolConfig<DubGetAnalyticsParams, DubGetAnalyticsResponse> = {
  id: 'dub_get_analytics',
  name: 'Dub Get Analytics',
  description:
    'Retrieve analytics for links including clicks, leads, and sales. Supports filtering by link, time range, and grouping by various dimensions.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dub API key',
    },
    event: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event type: clicks (default), leads, sales, or composite',
    },
    groupBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Group results by: count (default), timeseries, countries, cities, devices, browsers, os, referers, top_links, top_urls',
    },
    linkId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by link ID',
    },
    externalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by external ID (prefix with ext_)',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by domain',
    },
    interval: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time interval: 24h (default), 7d, 30d, 90d, 1y, mtd, qtd, ytd, or all',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date/time in ISO 8601 format (overrides interval)',
    },
    end: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date/time in ISO 8601 format (defaults to now)',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by country (ISO 3166-1 alpha-2 code)',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'IANA timezone for timeseries data (defaults to UTC)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.dub.co/analytics')
      if (params.event) url.searchParams.set('event', params.event)
      if (params.groupBy) url.searchParams.set('groupBy', params.groupBy)
      if (params.linkId) url.searchParams.set('linkId', params.linkId)
      if (params.externalId) url.searchParams.set('externalId', params.externalId)
      if (params.domain) url.searchParams.set('domain', params.domain)
      if (params.interval) url.searchParams.set('interval', params.interval)
      if (params.start) url.searchParams.set('start', params.start)
      if (params.end) url.searchParams.set('end', params.end)
      if (params.country) url.searchParams.set('country', params.country)
      if (params.timezone) url.searchParams.set('timezone', params.timezone)
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
      throw new Error(data.error?.message || data.error || 'Failed to get analytics')
    }

    if (Array.isArray(data)) {
      return {
        success: true,
        output: {
          clicks: 0,
          leads: 0,
          sales: 0,
          saleAmount: 0,
          data,
        },
      }
    }

    return {
      success: true,
      output: {
        clicks: data.clicks ?? 0,
        leads: data.leads ?? 0,
        sales: data.sales ?? 0,
        saleAmount: data.saleAmount ?? 0,
        data: null,
      },
    }
  },

  outputs: {
    clicks: { type: 'number', description: 'Total number of clicks' },
    leads: { type: 'number', description: 'Total number of leads' },
    sales: { type: 'number', description: 'Total number of sales' },
    saleAmount: { type: 'number', description: 'Total sale amount in cents' },
    data: {
      type: 'json',
      description: 'Grouped analytics data (timeseries, countries, devices, etc.)',
      optional: true,
    },
  },
}
