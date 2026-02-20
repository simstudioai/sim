import type {
  CloudflareDnsAnalyticsParams,
  CloudflareDnsAnalyticsResponse,
} from '@/tools/cloudflare/types'
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
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated metrics to retrieve (e.g., "queryCount,uncachedCount,staleCount,responseTimeAvg,responseTimeMedian,responseTime90th,responseTime99th")',
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
        `https://api.cloudflare.com/client/v4/zones/${params.zoneId}/dns_analytics/report`
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
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          totals: {
            queryCount: 0,
            uncachedCount: 0,
            staleCount: 0,
            responseTimeAvg: 0,
            responseTimeMedian: 0,
            responseTime90th: 0,
            responseTime99th: 0,
          },
          min: {
            queryCount: 0,
            uncachedCount: 0,
            staleCount: 0,
            responseTimeAvg: 0,
            responseTimeMedian: 0,
            responseTime90th: 0,
            responseTime99th: 0,
          },
          max: {
            queryCount: 0,
            uncachedCount: 0,
            staleCount: 0,
            responseTimeAvg: 0,
            responseTimeMedian: 0,
            responseTime90th: 0,
            responseTime99th: 0,
          },
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
        totals: {
          queryCount: result?.totals?.queryCount ?? 0,
          uncachedCount: result?.totals?.uncachedCount ?? 0,
          staleCount: result?.totals?.staleCount ?? 0,
          responseTimeAvg: result?.totals?.responseTimeAvg ?? 0,
          responseTimeMedian: result?.totals?.responseTimeMedian ?? 0,
          responseTime90th: result?.totals?.responseTime90th ?? 0,
          responseTime99th: result?.totals?.responseTime99th ?? 0,
        },
        min: {
          queryCount: result?.min?.queryCount ?? 0,
          uncachedCount: result?.min?.uncachedCount ?? 0,
          staleCount: result?.min?.staleCount ?? 0,
          responseTimeAvg: result?.min?.responseTimeAvg ?? 0,
          responseTimeMedian: result?.min?.responseTimeMedian ?? 0,
          responseTime90th: result?.min?.responseTime90th ?? 0,
          responseTime99th: result?.min?.responseTime99th ?? 0,
        },
        max: {
          queryCount: result?.max?.queryCount ?? 0,
          uncachedCount: result?.max?.uncachedCount ?? 0,
          staleCount: result?.max?.staleCount ?? 0,
          responseTimeAvg: result?.max?.responseTimeAvg ?? 0,
          responseTimeMedian: result?.max?.responseTimeMedian ?? 0,
          responseTime90th: result?.max?.responseTime90th ?? 0,
          responseTime99th: result?.max?.responseTime99th ?? 0,
        },
        data:
          result?.data?.map((entry: any) => ({
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
      description: 'Aggregate DNS analytics totals for the entire queried period',
      properties: {
        queryCount: { type: 'number', description: 'Total number of DNS queries' },
        uncachedCount: { type: 'number', description: 'Number of uncached DNS queries' },
        staleCount: { type: 'number', description: 'Number of stale DNS queries' },
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
      type: 'object',
      description: 'Minimum values across the analytics period',
      optional: true,
      properties: {
        queryCount: { type: 'number', description: 'Minimum number of DNS queries' },
        uncachedCount: { type: 'number', description: 'Minimum number of uncached DNS queries' },
        staleCount: { type: 'number', description: 'Minimum number of stale DNS queries' },
        responseTimeAvg: {
          type: 'number',
          description: 'Minimum average response time in milliseconds',
          optional: true,
        },
        responseTimeMedian: {
          type: 'number',
          description: 'Minimum median response time in milliseconds',
          optional: true,
        },
        responseTime90th: {
          type: 'number',
          description: 'Minimum 90th percentile response time in milliseconds',
          optional: true,
        },
        responseTime99th: {
          type: 'number',
          description: 'Minimum 99th percentile response time in milliseconds',
          optional: true,
        },
      },
    },
    max: {
      type: 'object',
      description: 'Maximum values across the analytics period',
      optional: true,
      properties: {
        queryCount: { type: 'number', description: 'Maximum number of DNS queries' },
        uncachedCount: { type: 'number', description: 'Maximum number of uncached DNS queries' },
        staleCount: { type: 'number', description: 'Maximum number of stale DNS queries' },
        responseTimeAvg: {
          type: 'number',
          description: 'Maximum average response time in milliseconds',
          optional: true,
        },
        responseTimeMedian: {
          type: 'number',
          description: 'Maximum median response time in milliseconds',
          optional: true,
        },
        responseTime90th: {
          type: 'number',
          description: 'Maximum 90th percentile response time in milliseconds',
          optional: true,
        },
        responseTime99th: {
          type: 'number',
          description: 'Maximum 99th percentile response time in milliseconds',
          optional: true,
        },
      },
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
