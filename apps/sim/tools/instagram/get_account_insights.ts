import type {
  InstagramGetAccountInsightsParams,
  InstagramGetAccountInsightsResponse,
} from '@/tools/instagram/types'
import {
  bearerHeaders,
  graphUrl,
  parseCommaSeparated,
  readGraphError,
} from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramGetAccountInsightsTool: ToolConfig<
  InstagramGetAccountInsightsParams,
  InstagramGetAccountInsightsResponse
> = {
  id: 'instagram_get_account_insights',
  name: 'Instagram Get Account Insights',
  description: 'Get insights metrics for the Instagram professional account',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'instagram',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Instagram API',
    },
    igUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Instagram professional account user id (defaults to /me)',
    },
    metrics: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated metrics (e.g. reach,views,accounts_engaged,profile_views,follower_count)',
    },
    period: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Aggregation period: day, week, days_28, lifetime, or total_over_range',
    },
    since: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unix timestamp or date for range start',
    },
    until: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unix timestamp or date for range end',
    },
    metricType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional metric_type (e.g. time_series, total_value)',
    },
    breakdown: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional breakdown dimension',
    },
    timeframe: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Required lookback window for demographic metrics',
    },
  },

  request: {
    url: (params) => {
      const path = params.igUserId?.trim() ? `/${params.igUserId.trim()}/insights` : '/me/insights'
      return graphUrl(path, {
        metric: parseCommaSeparated(params.metrics).join(','),
        period: params.period.trim(),
        since: params.since?.trim() || undefined,
        until: params.until?.trim() || undefined,
        metric_type: params.metricType?.trim() || undefined,
        breakdown: params.breakdown?.trim() || undefined,
        timeframe: params.timeframe?.trim() || undefined,
      })
    },
    method: 'GET',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramGetAccountInsightsResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { insights: [] },
        error: await readGraphError(response),
      }
    }

    const data = await response.json()
    const items = Array.isArray(data.data) ? data.data : []

    return {
      success: true,
      output: {
        insights: items.map((item: Record<string, unknown>) => ({
          name: (item.name as string | undefined) ?? null,
          period: (item.period as string | undefined) ?? null,
          title: (item.title as string | undefined) ?? null,
          description: (item.description as string | undefined) ?? null,
          values: Array.isArray(item.values) ? item.values : [],
          totalValue: item.total_value ?? null,
        })),
      },
    }
  },

  outputs: {
    insights: {
      type: 'json',
      description: 'Insight metrics (name, period, title, description, values, totalValue)',
    },
  },
}
