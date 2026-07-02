import type { AhrefsMetricsParams, AhrefsMetricsResponse } from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

export const metricsTool: ToolConfig<AhrefsMetricsParams, AhrefsMetricsResponse> = {
  id: 'ahrefs_metrics',
  name: 'Ahrefs Metrics',
  description:
    'Get a one-call organic and paid search overview for a target domain or URL: organic traffic, organic keywords, paid traffic, paid keywords, and estimated traffic cost.',
  version: '1.0.0',

  params: {
    target: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target domain or URL to analyze. Example: "example.com"',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country code for traffic data. Example: "us", "gb", "de"',
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
      const url = new URL('https://api.ahrefs.com/v3/site-explorer/metrics')
      url.searchParams.set('target', params.target)
      // Date is required - default to today if not provided
      const date = params.date || new Date().toISOString().split('T')[0]
      url.searchParams.set('date', date)
      if (params.country) url.searchParams.set('country', params.country)
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
      throw new Error(data.error?.message || data.error || 'Failed to get metrics')
    }

    const metrics = data.metrics || {}

    return {
      success: true,
      output: {
        metrics: {
          organicTraffic: metrics.org_traffic ?? 0,
          organicKeywords: metrics.org_keywords ?? 0,
          organicKeywordsTop3: metrics.org_keywords_1_3 ?? 0,
          organicCost: metrics.org_cost ?? null,
          paidTraffic: metrics.paid_traffic ?? 0,
          paidKeywords: metrics.paid_keywords ?? 0,
          paidPages: metrics.paid_pages ?? 0,
          paidCost: metrics.paid_cost ?? null,
        },
      },
    }
  },

  outputs: {
    metrics: {
      type: 'object',
      description: 'Organic and paid search overview',
      properties: {
        organicTraffic: { type: 'number', description: 'Estimated monthly organic traffic' },
        organicKeywords: { type: 'number', description: 'Number of organic keywords ranked' },
        organicKeywordsTop3: {
          type: 'number',
          description: 'Number of organic keywords ranking in positions 1-3',
        },
        organicCost: {
          type: 'number',
          description: 'Estimated monthly cost to replicate organic traffic via ads (USD)',
          optional: true,
        },
        paidTraffic: { type: 'number', description: 'Estimated monthly paid search traffic' },
        paidKeywords: { type: 'number', description: 'Number of paid keywords targeted' },
        paidPages: { type: 'number', description: 'Number of pages receiving paid traffic' },
        paidCost: {
          type: 'number',
          description: 'Estimated monthly paid search spend (USD)',
          optional: true,
        },
      },
    },
  },
}
