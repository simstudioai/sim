import type { AmplitudeRetentionParams, AmplitudeRetentionResponse } from '@/tools/amplitude/types'
import { getDashboardHost } from '@/tools/amplitude/utils'
import type { ToolConfig } from '@/tools/types'

export const retentionTool: ToolConfig<AmplitudeRetentionParams, AmplitudeRetentionResponse> = {
  id: 'amplitude_retention',
  name: 'Amplitude Retention',
  description: 'Measure how many users return to perform an action after a starting action.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Amplitude API Key',
    },
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Amplitude Secret Key',
    },
    startEvent: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON starting event object, e.g. {"event_type":"_new"} or {"event_type":"_active"}',
    },
    returnEvent: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON returning event object, e.g. {"event_type":"_all"} or {"event_type":"_active"}',
    },
    start: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date in YYYYMMDD format',
    },
    end: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End date in YYYYMMDD format',
    },
    retentionMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Retention type: "bracket", "rolling", or "n-day" (default: n-day)',
    },
    retentionBrackets: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Required when Retention Mode is "bracket". Day ranges, e.g. [[0,4]]',
    },
    interval: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time interval: 1 (daily), 7 (weekly), or 30 (monthly)',
    },
    groupBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Property to group by (limit: one; prefix custom properties with "gp:")',
    },
    segment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON segment definition(s) applied to the query',
    },
    dataResidency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Data residency region: "us" (default) or "eu"',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${getDashboardHost(params.dataResidency)}/api/2/retention`)

      const parseEventObject = (value: string, fieldName: string): Record<string, unknown> => {
        let parsed: unknown
        try {
          parsed = JSON.parse(value)
        } catch {
          parsed = undefined
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error(`Amplitude Retention: "${fieldName}" must be a valid JSON event object`)
        }
        return parsed as Record<string, unknown>
      }

      url.searchParams.set('se', JSON.stringify(parseEventObject(params.startEvent, 'startEvent')))
      url.searchParams.set(
        're',
        JSON.stringify(parseEventObject(params.returnEvent, 'returnEvent'))
      )
      url.searchParams.set('start', params.start)
      url.searchParams.set('end', params.end)
      if (params.retentionMode) url.searchParams.set('rm', params.retentionMode)
      if (params.retentionBrackets) url.searchParams.set('rb', params.retentionBrackets)
      if (params.interval) url.searchParams.set('i', params.interval)
      if (params.groupBy) url.searchParams.set('g', params.groupBy)
      if (params.segment) url.searchParams.set('s', params.segment)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:${params.secretKey}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || `Amplitude Retention API error: ${response.status}`)
    }

    const result = data.data ?? {}

    return {
      success: true,
      output: {
        series: result.series ?? [],
        seriesMeta: result.seriesMeta ?? [],
      },
    }
  },

  outputs: {
    series: {
      type: 'array',
      description:
        'Retention data series [{dates, values: {<date>: [{count, outof, incomplete}]}, combined: [{count, outof, incomplete}]}]',
      items: {
        type: 'json',
        properties: {
          dates: { type: 'array', description: 'Cohort dates', items: { type: 'string' } },
          values: { type: 'json', description: 'Per-cohort-date retention counts keyed by date' },
          combined: {
            type: 'json',
            description: 'Deduplicated aggregate retention across all cohorts',
          },
        },
      },
    },
    seriesMeta: {
      type: 'array',
      description: 'Segment/event index metadata for each series entry',
      items: { type: 'json' },
    },
  },
}
