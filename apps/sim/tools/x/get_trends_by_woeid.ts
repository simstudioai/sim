import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XGetTrendsByWoeidParams, XTrendListResponse } from '@/tools/x/types'
import { transformTrend } from '@/tools/x/types'

const logger = createLogger('XGetTrendsByWoeidTool')

export const xGetTrendsByWoeidTool: ToolConfig<XGetTrendsByWoeidParams, XTrendListResponse> = {
  id: 'x_get_trends_by_woeid',
  name: 'X Get Trends By WOEID',
  description:
    'Get trending topics for a specific location by WOEID (e.g., 1 for worldwide, 23424977 for US)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'x',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'X OAuth access token',
    },
    woeid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Yahoo Where On Earth ID (e.g., "1" for worldwide, "23424977" for US, "23424975" for UK)',
    },
    maxTrends: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of trends to return (1-50, default 20)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams({
        'trend.fields': 'trend_name,tweet_count',
      })

      if (params.maxTrends) {
        queryParams.append('max_trends', Number(params.maxTrends).toString())
      }

      return `https://api.x.com/2/trends/by/woeid/${params.woeid.trim()}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.data || !Array.isArray(data.data)) {
      logger.error('X Get Trends API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.errors?.[0]?.detail || 'No trends found or invalid response',
        output: {
          trends: [],
        },
      }
    }

    return {
      success: true,
      output: {
        trends: data.data.map(transformTrend),
      },
    }
  },

  outputs: {
    trends: {
      type: 'array',
      description: 'Array of trending topics',
      items: {
        type: 'object',
        properties: {
          trendName: { type: 'string', description: 'Name of the trending topic' },
          tweetCount: {
            type: 'number',
            description: 'Number of tweets for this trend',
            optional: true,
          },
        },
      },
    },
  },
}
