import {
  DOWNDETECTOR_API_BASE,
  type DowndetectorGetReportsParams,
  type DowndetectorGetReportsResponse,
} from '@/tools/downdetector/types'
import { downdetectorHeaders, extractDowndetectorError } from '@/tools/downdetector/utils'
import type { ToolConfig } from '@/tools/types'

interface RawReportBucket {
  point_in_time?: string
  total?: number
  indicators?: number
  other?: number
}

export const getReportsTool: ToolConfig<
  DowndetectorGetReportsParams,
  DowndetectorGetReportsResponse
> = {
  id: 'downdetector_get_reports',
  name: 'Downdetector Get Reports',
  description:
    'Get the number of outage reports over time for one or more company slugs, bucketed by interval. Useful for plotting report trends or detecting spikes. Defaults to the last 24 hours.',
  version: '1.0.0',

  params: {
    slugs: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated company slug(s) to report on. Example: "slack,zoom"',
    },
    startdate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 start of the time range (only works together with enddate)',
    },
    enddate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 end of the time range (only works together with startdate)',
    },
    interval: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bucket interval, e.g. "15m", "1h", "1d" (default "15m")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Downdetector API Bearer token',
    },
  },

  request: {
    url: (params) => {
      // The {slugs} path segment is a comma-delimited list, so escape each slug
      // individually and keep the commas literal as the array delimiter.
      const slugPath = params.slugs
        .split(',')
        .map((slug) => encodeURIComponent(slug.trim()))
        .filter((slug) => slug.length > 0)
        .join(',')
      if (!slugPath) {
        throw new Error('At least one non-empty slug is required')
      }
      const url = new URL(`${DOWNDETECTOR_API_BASE}/slugs/${slugPath}/reports`)
      if (params.startdate) url.searchParams.set('startdate', params.startdate)
      if (params.enddate) url.searchParams.set('enddate', params.enddate)
      if (params.interval) url.searchParams.set('interval', params.interval)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => downdetectorHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(extractDowndetectorError(data, 'Failed to get reports'))
    }

    const rows: RawReportBucket[] = Array.isArray(data) ? data : []
    const reports = rows.map((bucket) => ({
      pointInTime: bucket.point_in_time ?? null,
      total: bucket.total ?? null,
      indicators: bucket.indicators ?? null,
      other: bucket.other ?? null,
    }))

    return { success: true, output: { reports } }
  },

  outputs: {
    reports: {
      type: 'array',
      description: 'Report counts bucketed by interval',
      items: {
        type: 'object',
        properties: {
          pointInTime: { type: 'string', description: 'Start of the time bucket (ISO 8601)' },
          total: { type: 'number', description: 'Total number of reports in the bucket' },
          indicators: { type: 'number', description: 'Number of indicator reports' },
          other: { type: 'number', description: 'Number of reports from other sources' },
        },
      },
    },
  },
}
