import type {
  InstagramGetMediaInsightsParams,
  InstagramGetMediaInsightsResponse,
} from '@/tools/instagram/types'
import {
  bearerHeaders,
  graphUrl,
  parseCommaSeparated,
  readGraphError,
} from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramGetMediaInsightsTool: ToolConfig<
  InstagramGetMediaInsightsParams,
  InstagramGetMediaInsightsResponse
> = {
  id: 'instagram_get_media_insights',
  name: 'Instagram Get Media Insights',
  description: 'Get insights metrics for a specific Instagram media object',
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
    mediaId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Instagram media id',
    },
    metrics: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated metrics (e.g. views,reach,likes,comments,saved,shares,total_interactions)',
    },
  },

  request: {
    url: (params) =>
      graphUrl(`/${params.mediaId.trim()}/insights`, {
        metric: parseCommaSeparated(params.metrics).join(',') || params.metrics.trim(),
      }),
    method: 'GET',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramGetMediaInsightsResponse> => {
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
      description: 'Media insight metrics (name, period, title, description, values, totalValue)',
    },
  },
}
