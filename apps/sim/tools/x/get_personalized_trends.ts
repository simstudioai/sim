import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XGetPersonalizedTrendsParams, XTrendListResponse } from '@/tools/x/types'
import { transformTrend } from '@/tools/x/types'

const logger = createLogger('XGetPersonalizedTrendsTool')

export const xGetPersonalizedTrendsTool: ToolConfig<
  XGetPersonalizedTrendsParams,
  XTrendListResponse
> = {
  id: 'x_get_personalized_trends',
  name: 'X Get Personalized Trends',
  description: 'Get personalized trending topics for the authenticated user',
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
  },

  request: {
    url: 'https://api.x.com/2/users/personalized_trends',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.data || !Array.isArray(data.data)) {
      logger.error('X Get Personalized Trends API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.errors?.[0]?.detail || 'No personalized trends found or invalid response',
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
      description: 'Array of personalized trending topics',
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
