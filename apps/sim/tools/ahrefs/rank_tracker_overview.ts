import type {
  AhrefsRankTrackerOverviewParams,
  AhrefsRankTrackerOverviewResponse,
} from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

const SELECT_FIELDS =
  'keyword,position,volume,keyword_difficulty,url,traffic,serp_features,best_position_kind'

export const rankTrackerOverviewTool: ToolConfig<
  AhrefsRankTrackerOverviewParams,
  AhrefsRankTrackerOverviewResponse
> = {
  id: 'ahrefs_rank_tracker_overview',
  name: 'Ahrefs Rank Tracker Overview',
  description:
    'Get ranking overview metrics for the keywords tracked in an Ahrefs Rank Tracker project: position, search volume, keyword difficulty, and estimated traffic. This endpoint is free and does not consume API units.',
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
      description: 'Date to report rankings for, in YYYY-MM-DD format',
    },
    device: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Rankings device type: "desktop" or "mobile"',
    },
    dateCompared: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comparison date in YYYY-MM-DD format, to compute position/traffic deltas',
    },
    volumeMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search volume calculation: "monthly" or "average" (default: "monthly")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return. Example: 50 (default: 1000)',
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
      const url = new URL('https://api.ahrefs.com/v3/rank-tracker/overview')
      url.searchParams.set('project_id', String(params.projectId))
      url.searchParams.set('date', params.date)
      url.searchParams.set('device', params.device)
      url.searchParams.set('select', SELECT_FIELDS)
      if (params.dateCompared) url.searchParams.set('date_compared', params.dateCompared)
      url.searchParams.set('volume_mode', params.volumeMode || 'monthly')
      if (params.limit) url.searchParams.set('limit', String(params.limit))
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
      throw new Error(data.error?.message || data.error || 'Failed to get rank tracker overview')
    }

    const overviews = (data.overviews || []).map((item: any) => ({
      keyword: item.keyword || '',
      position: item.position ?? null,
      volume: item.volume ?? null,
      keywordDifficulty: item.keyword_difficulty ?? null,
      url: item.url ?? null,
      traffic: item.traffic ?? null,
      serpFeatures: item.serp_features ?? [],
      bestPositionKind: item.best_position_kind ?? null,
    }))

    return {
      success: true,
      output: {
        overviews,
      },
    }
  },

  outputs: {
    overviews: {
      type: 'array',
      description: 'Ranking overview for each tracked keyword',
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'The tracked keyword' },
          position: {
            type: 'number',
            description: 'Top organic search position',
            optional: true,
          },
          volume: { type: 'number', description: 'Average monthly search volume', optional: true },
          keywordDifficulty: {
            type: 'number',
            description: 'Keyword difficulty score (0-100)',
            optional: true,
          },
          url: { type: 'string', description: 'Top-ranking URL', optional: true },
          traffic: {
            type: 'number',
            description: 'Estimated monthly organic visits',
            optional: true,
          },
          serpFeatures: {
            type: 'array',
            description: 'SERP features present in the results',
            items: { type: 'string' },
          },
          bestPositionKind: {
            type: 'string',
            description: 'Type of the top position (organic, paid, or SERP feature)',
            optional: true,
          },
        },
      },
    },
  },
}
