import type {
  AhrefsRankTrackerCompetitorsStatsParams,
  AhrefsRankTrackerCompetitorsStatsResponse,
} from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

const SELECT_FIELDS =
  'competitor,traffic,traffic_value,average_position,pos_1_3,pos_4_10,share_of_voice,share_of_traffic_value'

export const rankTrackerCompetitorsStatsTool: ToolConfig<
  AhrefsRankTrackerCompetitorsStatsParams,
  AhrefsRankTrackerCompetitorsStatsResponse
> = {
  id: 'ahrefs_rank_tracker_competitors_stats',
  name: 'Ahrefs Rank Tracker Competitors Stats',
  description:
    "Get aggregate competitor stats for an Ahrefs Rank Tracker project: each competitor's traffic, traffic value, average position, and share of voice across all tracked keywords. This endpoint is free and does not consume API units.",
  version: '1.0.0',

  params: {
    projectId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Rank Tracker project ID (found in the project URL in Ahrefs)',
    },
    date: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Date to report metrics for, in YYYY-MM-DD format',
    },
    device: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Rankings device type: "desktop" or "mobile"',
    },
    volumeMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search volume calculation: "monthly" or "average" (default: "monthly")',
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
      const url = new URL('https://api.ahrefs.com/v3/rank-tracker/competitors-stats')
      url.searchParams.set('select', SELECT_FIELDS)
      url.searchParams.set('date', params.date)
      url.searchParams.set('device', params.device)
      url.searchParams.set('project_id', String(params.projectId))
      url.searchParams.set('volume_mode', params.volumeMode || 'monthly')
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
      throw new Error(
        data.error?.message || data.error || 'Failed to get rank tracker competitors stats'
      )
    }

    const competitorsStats = (data['competitors-metrics'] || []).map((item: any) => ({
      competitor: item.competitor || '',
      traffic: item.traffic ?? null,
      trafficValue: item.traffic_value ?? null,
      averagePosition: item.average_position ?? null,
      pos1To3: item.pos_1_3 ?? 0,
      pos4To10: item.pos_4_10 ?? 0,
      shareOfVoice: item.share_of_voice ?? 0,
      shareOfTrafficValue: item.share_of_traffic_value ?? 0,
    }))

    return {
      success: true,
      output: {
        competitorsStats,
      },
    }
  },

  outputs: {
    competitorsStats: {
      type: 'array',
      description: 'Aggregate stats for each tracked competitor',
      items: {
        type: 'object',
        properties: {
          competitor: { type: 'string', description: "The competitor's URL" },
          traffic: {
            type: 'number',
            description: 'Estimated monthly organic visits',
            optional: true,
          },
          trafficValue: {
            type: 'number',
            description: 'Estimated monthly organic traffic value',
            optional: true,
          },
          averagePosition: {
            type: 'number',
            description: 'Average top organic position across tracked keywords',
            optional: true,
          },
          pos1To3: { type: 'number', description: 'Keywords ranking in top 3 positions' },
          pos4To10: { type: 'number', description: 'Keywords ranking in positions 4-10' },
          shareOfVoice: { type: 'number', description: 'Organic traffic share percentage' },
          shareOfTrafficValue: {
            type: 'number',
            description: 'Organic traffic value share percentage',
          },
        },
      },
    },
  },
}
