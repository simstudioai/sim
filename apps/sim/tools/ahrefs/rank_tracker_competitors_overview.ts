import type {
  AhrefsRankTrackerCompetitorsOverviewParams,
  AhrefsRankTrackerCompetitorsOverviewResponse,
} from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

const SELECT_FIELDS = 'keyword,volume,keyword_difficulty,serp_features,competitors_list'

export const rankTrackerCompetitorsOverviewTool: ToolConfig<
  AhrefsRankTrackerCompetitorsOverviewParams,
  AhrefsRankTrackerCompetitorsOverviewResponse
> = {
  id: 'ahrefs_rank_tracker_competitors_overview',
  name: 'Ahrefs Rank Tracker Competitors Overview',
  description:
    "Get competitor rankings for the keywords tracked in an Ahrefs Rank Tracker project: each tracked keyword's volume and difficulty alongside every competitor's position, traffic, and traffic value. This endpoint is free and does not consume API units.",
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
      const url = new URL('https://api.ahrefs.com/v3/rank-tracker/competitors-overview')
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
      throw new Error(
        data.error?.message || data.error || 'Failed to get rank tracker competitors overview'
      )
    }

    const competitorKeywords = (data.keywords || []).map((item: any) => ({
      keyword: item.keyword || '',
      volume: item.volume ?? null,
      keywordDifficulty: item.keyword_difficulty ?? null,
      serpFeatures: item.serp_features ?? [],
      competitorsList: (item.competitors_list || []).map((competitor: any) => ({
        url: competitor.url || '',
        position: competitor.position ?? null,
        bestPositionKind: competitor.best_position_kind ?? null,
        traffic: competitor.traffic ?? null,
        value: typeof competitor.value === 'number' ? competitor.value / 100 : null,
      })),
    }))

    return {
      success: true,
      output: {
        competitorKeywords,
      },
    }
  },

  outputs: {
    competitorKeywords: {
      type: 'array',
      description: 'Tracked keywords with competitor ranking data',
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'The tracked keyword' },
          volume: { type: 'number', description: 'Average monthly search volume', optional: true },
          keywordDifficulty: {
            type: 'number',
            description: 'Keyword difficulty score (0-100)',
            optional: true,
          },
          serpFeatures: {
            type: 'array',
            description: 'SERP features present in the results',
            items: { type: 'string' },
          },
          competitorsList: {
            type: 'array',
            description: 'Ranking data for each tracked competitor on this keyword',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string', description: "The competitor's ranking URL" },
                position: {
                  type: 'number',
                  description: 'Current ranking position',
                  optional: true,
                },
                bestPositionKind: {
                  type: 'string',
                  description: 'Type of the best position achieved',
                  optional: true,
                },
                traffic: {
                  type: 'number',
                  description: 'Estimated traffic to the competitor',
                  optional: true,
                },
                value: {
                  type: 'number',
                  description: 'Estimated traffic value (USD)',
                  optional: true,
                },
              },
            },
          },
        },
      },
    },
  },
}
