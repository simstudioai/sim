import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type { ChartQueryShareOutput } from '@/tools/chartquery/types'

export const CHARTQUERY_API_BASE = 'https://api.chartquery.com/v1'

/** Headers for a ChartQuery JSON request. */
export function chartQueryHeaders(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

/**
 * Builds a request body: every ChartQuery tool asks for `share: true` so the API returns
 * public links instead of binary image data. Unset optional values are left out; strings are
 * sent as given, since spaces can be part of the value to encode.
 */
export function chartQueryBody(fields: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    body[key] = value
  }
  body.share = true
  return body
}

/** Reads a Chart.js config passed as an object or as a JSON string. */
export function parseChartConfig(
  config: Record<string, unknown> | string
): Record<string, unknown> {
  if (typeof config !== 'string') return toRecord(config)
  try {
    return toRecord(JSON.parse(config))
  } catch {
    throw new Error('Chart config must be valid JSON, for example {"type":"bar","data":{...}}')
  }
}

/** Reads the share links from a ChartQuery response. */
export function mapChartQueryShare(value: unknown): ChartQueryShareOutput {
  const data = toRecord(value)
  return {
    id: toStringOrNull(data.id),
    renderUrl: toStringOrNull(data.render_url),
    viewUrl: toStringOrNull(data.view_url),
    embedHtml: toStringOrNull(data.embed_url),
    expiresIn: toStringOrNull(data.expires_in),
  }
}
