import { isRecordLike } from '@sim/utils/object'
import type { AmplitudeFunnelsParams, AmplitudeFunnelsResponse } from '@/tools/amplitude/types'
import { getDashboardHost } from '@/tools/amplitude/utils'
import type { ToolConfig } from '@/tools/types'

export const funnelsTool: ToolConfig<AmplitudeFunnelsParams, AmplitudeFunnelsResponse> = {
  id: 'amplitude_funnels',
  name: 'Amplitude Funnels',
  description: 'Analyze conversion rates and drop-off between a sequence of events.',
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
    events: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of event objects, one per funnel step in order, e.g. [{"event_type":"signup"},{"event_type":"purchase"}]',
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
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Funnel ordering: "ordered", "unordered", or "sequential" (default: ordered)',
    },
    userType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User type: "new" or "active" (default: active)',
    },
    interval: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Time interval: -300000 (real-time), -3600000 (hourly), 1 (daily), 7 (weekly), or 30 (monthly)',
    },
    conversionWindowSeconds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversion window in seconds (default: 2592000, i.e. 30 days)',
    },
    groupBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Property to group by (limit: one; prefix custom properties with "gp:")',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of group-by values (default: 100, max: 1000)',
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
      const url = new URL(`${getDashboardHost(params.dataResidency)}/api/2/funnels`)
      let parsed: unknown
      try {
        parsed = JSON.parse(params.events)
      } catch {
        throw new Error('Amplitude Funnels: "events" must be a valid JSON array of event objects')
      }
      if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isRecordLike)) {
        throw new Error(
          'Amplitude Funnels: "events" must be a non-empty JSON array of event objects'
        )
      }
      for (const step of parsed) {
        url.searchParams.append('e', JSON.stringify(step))
      }
      url.searchParams.set('start', params.start)
      url.searchParams.set('end', params.end)
      if (params.mode) url.searchParams.set('mode', params.mode)
      if (params.userType) url.searchParams.set('n', params.userType)
      if (params.interval) url.searchParams.set('i', params.interval)
      if (params.conversionWindowSeconds) url.searchParams.set('cs', params.conversionWindowSeconds)
      if (params.groupBy) url.searchParams.set('g', params.groupBy)
      if (params.limit) url.searchParams.set('limit', params.limit)
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
      throw new Error(data.error || `Amplitude Funnels API error: ${response.status}`)
    }

    const results = (Array.isArray(data.data) ? data.data : []) as Array<Record<string, unknown>>

    const funnels = results.map((r) => {
      const dayFunnels = r.dayFunnels as Record<string, unknown> | undefined
      return {
        stepByStep: (r.stepByStep as number[]) ?? [],
        cumulative: (r.cumulative as number[]) ?? [],
        cumulativeRaw: (r.cumulativeRaw as number[]) ?? [],
        medianTransTimes: (r.medianTransTimes as number[]) ?? [],
        avgTransTimes: (r.avgTransTimes as number[]) ?? [],
        events: (r.events as string[]) ?? [],
        dayFunnels: dayFunnels
          ? {
              series: (dayFunnels.series as number[][]) ?? [],
              xValues: (dayFunnels.xValues as string[]) ?? [],
            }
          : null,
      }
    })

    return {
      success: true,
      output: { funnels },
    }
  },

  outputs: {
    funnels: {
      type: 'array',
      description: 'Funnel results, one entry per segment',
      items: {
        type: 'object',
        properties: {
          stepByStep: { type: 'json', description: 'Conversion count at each step' },
          cumulative: {
            type: 'json',
            description: 'Cumulative conversion percentage at each step',
          },
          cumulativeRaw: { type: 'json', description: 'Cumulative conversion count at each step' },
          medianTransTimes: {
            type: 'json',
            description: 'Median transition time between steps (ms)',
          },
          avgTransTimes: {
            type: 'json',
            description: 'Average transition time between steps (ms)',
          },
          events: { type: 'json', description: 'Event names for each funnel step' },
          dayFunnels: {
            type: 'json',
            description: 'Daily funnel breakdown {series, xValues}',
            optional: true,
          },
        },
      },
    },
  },
}
