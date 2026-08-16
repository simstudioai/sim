import type {
  CloudflareDnsAnalyticsParams,
  CloudflareDnsAnalyticsResponse,
  CloudflareRawDnsAnalyticsReport,
} from '@/tools/cloudflare/types'
import { readCloudflareResponse } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const dnsAnalyticsTool: ToolConfig<
  CloudflareDnsAnalyticsParams,
  CloudflareDnsAnalyticsResponse
> = {
  id: 'cloudflare_dns_analytics',
  name: 'Cloudflare DNS Analytics',
  description: 'Gets DNS analytics report for a zone including query counts and trends.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to get DNS analytics for',
    },
    since: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start date for analytics (ISO 8601, e.g., "2024-01-01T00:00:00Z") or relative (e.g., "-6h")',
    },
    until: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'End date for analytics (ISO 8601, e.g., "2024-01-31T23:59:59Z") or relative (e.g., "now")',
    },
    metrics: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated metrics to retrieve (e.g., "queryCount,uncachedCount,staleCount,responseTimeAvg,responseTimeMedian,responseTime90th,responseTime99th"). Optional in the API',
    },
    dimensions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated dimensions to group by (e.g., "queryName,queryType,responseCode,responseCached,coloName,origin,dayOfWeek,tcp,ipVersion,querySizeBucket,responseSizeBucket")',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply to the data (e.g., "queryType==A")',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort order for the result set. Fields must be included in metrics or dimensions (e.g., "+queryCount" or "-responseTimeAvg")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/zones/${params.zoneId.trim()}/dns_analytics/report`
      )
      if (params.since) url.searchParams.append('since', params.since)
      if (params.until) url.searchParams.append('until', params.until)
      if (params.metrics) url.searchParams.append('metrics', params.metrics)
      if (params.dimensions) url.searchParams.append('dimensions', params.dimensions)
      if (params.filters) url.searchParams.append('filters', params.filters)
      if (params.sort) url.searchParams.append('sort', params.sort)
      if (params.limit) url.searchParams.append('limit', String(params.limit))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse<CloudflareRawDnsAnalyticsReport>(response)

    if (!data.success) {
      return {
        success: false,
        output: {
          totals: {},
          min: null,
          max: null,
          data: [],
          data_lag: 0,
          rows: 0,
          query: {
            since: '',
            until: '',
            metrics: [],
            dimensions: [],
            filters: '',
            sort: [],
            limit: 0,
          },
        },
        error: data.errors?.[0]?.message ?? 'Failed to get DNS analytics',
      }
    }

    const result = data.result
    return {
      success: true,
      output: {
        /**
         * Cloudflare only populates the metrics that were requested. Passing the
         * block through untouched keeps an unrequested metric absent instead of
         * reporting it as a measured zero.
         */
        totals: {
          queryCount: result?.totals?.queryCount,
          uncachedCount: result?.totals?.uncachedCount,
          staleCount: result?.totals?.staleCount,
          responseTimeAvg: result?.totals?.responseTimeAvg,
          responseTimeMedian: result?.totals?.responseTimeMedian,
          responseTime90th: result?.totals?.responseTime90th,
          responseTime99th: result?.totals?.responseTime99th,
        },
        min: result?.min ?? null,
        max: result?.max ?? null,
        data:
          result?.data?.map((entry) => ({
            dimensions: entry.dimensions ?? [],
            metrics: entry.metrics ?? [],
          })) ?? [],
        data_lag: result?.data_lag ?? 0,
        rows: result?.rows ?? 0,
        query: {
          since: result?.query?.since ?? '',
          until: result?.query?.until ?? '',
          metrics: result?.query?.metrics ?? [],
          dimensions: result?.query?.dimensions ?? [],
          filters: result?.query?.filters ?? '',
          sort: result?.query?.sort ?? [],
          limit: result?.query?.limit ?? 0,
        },
      },
    }
  },

  outputs: {
    totals: {
      type: 'object',
      description:
        'Aggregate DNS analytics totals for the entire queried period. Only the metrics that were requested are present.',
      properties: {
        queryCount: {
          type: 'number',
          description: 'Total number of DNS queries. Absent when queryCount was not requested',
          optional: true,
        },
        uncachedCount: {
          type: 'number',
          description:
            'Number of uncached DNS queries. Absent when uncachedCount was not requested',
          optional: true,
        },
        staleCount: {
          type: 'number',
          description: 'Number of stale DNS queries. Absent when staleCount was not requested',
          optional: true,
        },
        responseTimeAvg: {
          type: 'number',
          description: 'Average response time in milliseconds',
          optional: true,
        },
        responseTimeMedian: {
          type: 'number',
          description: 'Median response time in milliseconds',
          optional: true,
        },
        responseTime90th: {
          type: 'number',
          description: '90th percentile response time in milliseconds',
          optional: true,
        },
        responseTime99th: {
          type: 'number',
          description: '99th percentile response time in milliseconds',
          optional: true,
        },
      },
    },
    min: {
      type: 'json',
      description:
        'Per-metric minimums. Cloudflare documents this field as currently always an empty object, so treat a populated value as unexpected rather than relied upon.',
      optional: true,
    },
    max: {
      type: 'json',
      description:
        'Per-metric maximums. Cloudflare documents this field as currently always an empty object, so treat a populated value as unexpected rather than relied upon.',
      optional: true,
    },
    data: {
      type: 'array',
      description: 'Raw analytics data rows returned by the Cloudflare DNS analytics report',
      items: {
        type: 'object',
        properties: {
          dimensions: {
            type: 'array',
            description:
              'Dimension values for this data row, parallel to the requested dimensions list',
            items: { type: 'string', description: 'Dimension value' },
          },
          metrics: {
            type: 'array',
            description: 'Metric values for this data row, parallel to the requested metrics list',
            items: { type: 'number', description: 'Metric value' },
          },
        },
      },
    },
    data_lag: {
      type: 'number',
      description: 'Processing lag in seconds before analytics data becomes available',
    },
    rows: {
      type: 'number',
      description: 'Total number of rows in the result set',
    },
    query: {
      type: 'object',
      description: 'Echo of the query parameters sent to the API',
      optional: true,
      properties: {
        since: { type: 'string', description: 'Start date of the analytics query' },
        until: { type: 'string', description: 'End date of the analytics query' },
        metrics: {
          type: 'array',
          description: 'Metrics requested in the query',
          items: { type: 'string', description: 'Metric name' },
        },
        dimensions: {
          type: 'array',
          description: 'Dimensions requested in the query',
          items: { type: 'string', description: 'Dimension name' },
        },
        filters: { type: 'string', description: 'Filters applied to the query' },
        sort: {
          type: 'array',
          description: 'Sort order applied to the query',
          items: { type: 'string', description: 'Sort field with direction prefix' },
        },
        limit: { type: 'number', description: 'Maximum number of results requested' },
      },
    },
  },
}
