import { isRecordLike } from '@sim/utils/object'
import {
  COLUMN_PROPERTIES,
  DATE_RANGE_OUT_PROPERTIES,
  FRESHNESS_OUT_PROPERTIES,
} from '@/tools/gauge/outputs'
import type { GaugeQueryOut, GaugeQueryParams, GaugeQueryResponse } from '@/tools/gauge/types'
import {
  buildGaugeUrl,
  gaugeAuthParams,
  gaugeHeaders,
  gaugeOAuth,
  parseGaugeJson,
  parseGaugeStringArray,
} from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

function parseObject(value: unknown, name: string): Record<string, unknown> | undefined {
  const parsed = parseGaugeJson(value, name)
  if (parsed == null) return undefined
  if (!isRecordLike(parsed)) throw new Error(`${name} must be a JSON object`)
  return parsed
}

function parseArray(value: unknown, name: string): unknown[] | undefined {
  const parsed = parseGaugeJson(value, name)
  if (parsed == null) return undefined
  if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array`)
  return parsed
}
export const gaugeQueryTool: ToolConfig<GaugeQueryParams, GaugeQueryResponse> = {
  id: 'gauge_query',
  name: 'Gauge Run Report Query',
  description:
    'Run a report on AI answers, citations, search queries, or AI bot traffic using metrics from the query catalog.',
  version: '1.0.0',
  oauth: gaugeOAuth,
  params: {
    ...gaugeAuthParams,
    org: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Organization slug or UUID',
    },
    dataset: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Report dataset: answers, citations, searchQueries, or aiTraffic',
    },
    dimensions: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of up to 3 dimension keys from Get Query Metadata',
    },
    metrics: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of 1–4 metric keys from Get Query Metadata',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of category, brand, model, topic, tag, tagMode, prompt, trackingType, domain, and page filters',
    },
    where: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of up to 10 predicates: {"dimension":"domain","op":"contains","value":"example.com"}',
    },
    dateRange: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object with since (YYYY-MM-DD or 30d), until (YYYY-MM-DD), or lastDays (1–400)',
    },
    granularity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Report time bucket: hour, day, week, or month (defaults to day)',
    },
    orderBy: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of up to 4 sort rules: {"key":"metric_name","dir":"desc"}',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum report rows (1–1000; defaults to 50)',
    },
  },
  request: {
    url: (params) => buildGaugeUrl(`/orgs/${safeUrlPathSegment(params.org, 'org')}/query`),
    method: 'POST',
    headers: (params) => gaugeHeaders(params.accessToken, true),
    body: (params) => ({
      dataset: params.dataset,
      dimensions:
        params.dimensions == null || params.dimensions === ''
          ? undefined
          : parseGaugeStringArray(params.dimensions, 'dimensions', { max: 3 }),
      metrics: parseGaugeStringArray(params.metrics, 'metrics', { min: 1, max: 4 }),
      filters: parseObject(params.filters, 'filters'),
      where: parseArray(params.where, 'where'),
      dateRange: parseObject(params.dateRange, 'dateRange'),
      granularity: params.granularity,
      orderBy: parseArray(params.orderBy, 'orderBy'),
      limit: params.limit,
    }),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeQueryOut
    return {
      success: true,
      output: {
        columns: (data.columns ?? []).map((item) => ({
          key: item.key,
          kind: item.kind,
          type: item.type,
          unit: item.unit ?? null,
        })),
        rows: data.rows ?? [],
        labels: data.labels ?? {},
        dateRange: { since: data.dateRange.since, until: data.dateRange.until },
        truncated: data.truncated,
        cached: data.cached,
        freshness: {
          watermark: data.freshness.watermark ?? null,
          pending: data.freshness.pending,
          available: data.freshness.available,
        },
      },
    }
  },
  outputs: {
    columns: {
      type: 'array',
      items: { type: 'object', properties: COLUMN_PROPERTIES },
      description: 'Columns',
    },
    rows: { type: 'array', items: { type: 'json' }, description: 'Rows' },
    labels: { type: 'json', description: 'Labels' },
    dateRange: { type: 'json', properties: DATE_RANGE_OUT_PROPERTIES, description: 'Date range' },
    truncated: { type: 'boolean', description: 'Truncated' },
    cached: { type: 'boolean', description: 'Cached' },
    freshness: { type: 'json', properties: FRESHNESS_OUT_PROPERTIES, description: 'Freshness' },
  },
}
