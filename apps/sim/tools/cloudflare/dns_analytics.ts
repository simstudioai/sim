import type {
  CloudflareDnsAnalyticsParams,
  CloudflareDnsAnalyticsResponse,
  CloudflareRawDnsAnalyticsGraphql,
} from '@/tools/cloudflare/types'
import { cloudflareHeaders } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Cloudflare removes the REST endpoint `/zones/{zone_id}/dns_analytics/report` on
 * December 1, 2026 (https://developers.cloudflare.com/fundamentals/api/reference/deprecations/).
 * This tool now reads the `dnsAnalyticsAdaptiveGroups` dataset of the GraphQL Analytics
 * API and maps it back onto the report shape, so existing workflows keep their outputs.
 *
 * The GraphQL dataset exposes a query count grouped by dimensions; the REST report's
 * cache and response-time metrics have no documented equivalent there, so asking for
 * them is an explicit error rather than a silent zero.
 */
const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql'
const SUPPORTED_DIMENSIONS = ['queryName', 'queryType', 'responseCode'] as const
type DnsDimension = (typeof SUPPORTED_DIMENSIONS)[number]
const SUPPORTED_METRICS = ['queryCount'] as const
const DEFAULT_WINDOW_DAYS = 7
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 10000

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** Accepts an ISO date/datetime or a REST-style relative offset such as "-6h", "-7d" or "now". */
export function toGraphqlDate(value: string | undefined, fallback: Date): string {
  if (!value || value === 'now') {
    return (value ? new Date() : fallback).toISOString().slice(0, 10)
  }
  const relative = /^-(\d+)([mhd])$/.exec(value.trim())
  if (relative) {
    const amount = Number(relative[1])
    const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2] as 'm' | 'h' | 'd']
    return new Date(Date.now() - amount * unitMs).toISOString().slice(0, 10)
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${value}`)
  return parsed.toISOString().slice(0, 10)
}

/**
 * REST filters used "field==value" joined by ";" (AND). Only equality on a supported
 * dimension has a GraphQL equivalent.
 */
export function toGraphqlFilter(filters: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const clauses = (filters ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
  for (const clause of clauses) {
    const match = /^(\w+)==(.+)$/.exec(clause)
    if (!match || !SUPPORTED_DIMENSIONS.includes(match[1] as DnsDimension)) {
      throw new Error(
        `Unsupported DNS analytics filter "${clause}". Use field==value on ${SUPPORTED_DIMENSIONS.join(', ')}, joined with ";".`
      )
    }
    out[match[1]] = match[2]
  }
  return out
}

/** "-queryCount" / "+queryName" become orderBy values such as count_DESC / queryName_ASC. */
export function toGraphqlOrderBy(sort: string | undefined): string[] {
  return splitList(sort).map((entry) => {
    const desc = entry.startsWith('-')
    const field = entry.replace(/^[+-]/, '')
    const name = field === 'queryCount' ? 'count' : field
    if (name !== 'count' && !SUPPORTED_DIMENSIONS.includes(name as DnsDimension)) {
      throw new Error(`Unsupported DNS analytics sort field "${field}"`)
    }
    return `${name}_${desc ? 'DESC' : 'ASC'}`
  })
}

export function buildDnsAnalyticsQuery(params: CloudflareDnsAnalyticsParams) {
  const dimensions = splitList(params.dimensions)
  const unsupportedDimensions = dimensions.filter(
    (d) => !SUPPORTED_DIMENSIONS.includes(d as DnsDimension)
  )
  if (unsupportedDimensions.length > 0) {
    throw new Error(
      `DNS analytics dimensions not available after Cloudflare's move to GraphQL: ${unsupportedDimensions.join(', ')}. Supported: ${SUPPORTED_DIMENSIONS.join(', ')}.`
    )
  }
  const metrics = splitList(params.metrics)
  const unsupportedMetrics = metrics.filter((m) => !SUPPORTED_METRICS.includes(m as 'queryCount'))
  if (unsupportedMetrics.length > 0) {
    throw new Error(
      `DNS analytics metrics not available after Cloudflare's move to GraphQL: ${unsupportedMetrics.join(', ')}. Supported: queryCount.`
    )
  }

  const now = new Date()
  const since = toGraphqlDate(
    params.since,
    new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000)
  )
  const until = toGraphqlDate(params.until, now)
  const filter = { date_geq: since, date_leq: until, ...toGraphqlFilter(params.filters) }
  const orderBy = toGraphqlOrderBy(params.sort)
  const limit = Math.min(Math.max(Number(params.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const dimensionBlock = dimensions.length > 0 ? ` dimensions { ${dimensions.join(' ')} }` : ''

  // Values are inlined as GraphQL literals (validated above, strings JSON-escaped) so the
  // query only declares $zoneTag, whose type Cloudflare documents.
  const literal = (value: string) => JSON.stringify(value)
  const filterLiteral = Object.entries(filter)
    .map(([key, value]) => `${key}: ${literal(String(value))}`)
    .join(', ')
  const orderLiteral = orderBy.length ? `, orderBy: [${orderBy.join(', ')}]` : ''
  const query = `query DnsAnalytics($zoneTag: string!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      dnsAnalyticsAdaptiveGroups(filter: { ${filterLiteral} }, limit: ${limit}${orderLiteral}) { count${dimensionBlock} }
    }
  }
}`
  const variables: Record<string, unknown> = { zoneTag: params.zoneId.trim() }
  return {
    query,
    variables,
    dimensions,
    metrics,
    since,
    until,
    filters: params.filters ?? '',
    sort: splitList(params.sort),
    limit,
  }
}

export const dnsAnalyticsTool: ToolConfig<
  CloudflareDnsAnalyticsParams,
  CloudflareDnsAnalyticsResponse
> = {
  id: 'cloudflare_dns_analytics',
  name: 'Cloudflare DNS Analytics',
  description:
    'Gets DNS analytics for a zone: query counts grouped by query name, type and response code (Cloudflare GraphQL Analytics API).',
  version: '2.0.0',

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
        'Start date (ISO 8601 or relative like "-7d"). The GraphQL dataset filters by day. Default: 7 days ago',
    },
    until: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'End date (ISO 8601 or "now"). The GraphQL dataset filters by day. Default: today',
    },
    metrics: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated metrics. Only "queryCount" is available from the GraphQL DNS analytics dataset. Optional',
    },
    dimensions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated dimensions to group by: queryName, queryType, responseCode',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Equality filters on a dimension, joined with ";" (e.g., "queryType==A;responseCode==NOERROR")',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort order, e.g. "-queryCount" or "+queryName"',
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
    url: () => GRAPHQL_URL,
    method: 'POST',
    headers: (params) => cloudflareHeaders(params.apiKey),
    body: (params) => {
      const { query, variables } = buildDnsAnalyticsQuery(params)
      return { query, variables }
    },
  },

  transformResponse: async (response: Response, params?: CloudflareDnsAnalyticsParams) => {
    const data = (await response.json()) as CloudflareRawDnsAnalyticsGraphql
    const built = params?.zoneId ? buildDnsAnalyticsQuery(params) : undefined
    const query = {
      since: built?.since ?? '',
      until: built?.until ?? '',
      metrics: built?.metrics ?? [],
      dimensions: built?.dimensions ?? [],
      filters: built?.filters ?? '',
      sort: built?.sort ?? [],
      limit: built?.limit ?? 0,
    }

    const error = data.errors?.[0]?.message
    if (error || !response.ok) {
      return {
        success: false,
        output: { totals: {}, min: null, max: null, data: [], data_lag: 0, rows: 0, query },
        error: error ?? `Failed to get DNS analytics (HTTP ${response.status})`,
      }
    }

    const groups = data.data?.viewer?.zones?.[0]?.dnsAnalyticsAdaptiveGroups ?? []
    const dimensions = query.dimensions as DnsDimension[]
    const wantsCount = query.metrics.length === 0 || query.metrics.includes('queryCount')
    return {
      success: true,
      output: {
        /** Only queryCount exists in the GraphQL dataset; other totals stay absent, not zero. */
        totals: wantsCount
          ? { queryCount: groups.reduce((sum, g) => sum + (g.count ?? 0), 0) }
          : {},
        min: null,
        max: null,
        data: groups.map((g) => ({
          dimensions: dimensions.map((d) => String(g.dimensions?.[d] ?? '')),
          metrics: wantsCount ? [g.count ?? 0] : [],
        })),
        data_lag: 0,
        rows: groups.length,
        query,
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
