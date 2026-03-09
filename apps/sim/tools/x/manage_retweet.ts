import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XManageRetweetParams, XManageRetweetResponse } from '@/tools/x/types'

const logger = createLogger('XManageRetweetTool')

export const xManageRetweetTool: ToolConfig<XManageRetweetParams, XManageRetweetResponse> = {
  id: 'x_manage_retweet',
  name: 'X Manage Retweet',
  description: 'Retweet or unretweet a tweet on X',
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
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The authenticated user ID',
    },
    tweetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The tweet ID to retweet or unretweet',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Action to perform: "retweet" or "unretweet"',
    },
  },

  request: {
    url: (params) => {
      if (params.action === 'unretweet') {
        return `https://api.x.com/2/users/${params.userId.trim()}/retweets/${params.tweetId.trim()}`
      }
      return `https://api.x.com/2/users/${params.userId.trim()}/retweets`
    },
    method: (params) => (params.action === 'unretweet' ? 'DELETE' : 'POST'),
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      if (params.action === 'unretweet') return undefined
      return {
        tweet_id: params.tweetId.trim(),
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.data) {
      logger.error('X Manage Retweet API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        output: {
          retweeted: false,
        },
        error: data.errors?.[0]?.detail ?? 'Failed to manage retweet',
      }
    }

    return {
      success: true,
      output: {
        retweeted: data.data?.retweeted ?? false,
      },
    }
  },

  outputs: {
    retweeted: {
      type: 'boolean',
      description: 'Whether the tweet is now retweeted',
    },
  },
}
