import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XManageLikeParams, XManageLikeResponse } from '@/tools/x/types'

const logger = createLogger('XManageLikeTool')

export const xManageLikeTool: ToolConfig<XManageLikeParams, XManageLikeResponse> = {
  id: 'x_manage_like',
  name: 'X Manage Like',
  description: 'Like or unlike a tweet on X',
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
      description: 'The tweet ID to like or unlike',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Action to perform: "like" or "unlike"',
    },
  },

  request: {
    url: (params) => {
      if (params.action === 'unlike') {
        return `https://api.x.com/2/users/${params.userId.trim()}/likes/${params.tweetId.trim()}`
      }
      return `https://api.x.com/2/users/${params.userId.trim()}/likes`
    },
    method: (params) => (params.action === 'unlike' ? 'DELETE' : 'POST'),
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      if (params.action === 'unlike') return undefined
      return {
        tweet_id: params.tweetId.trim(),
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.data) {
      logger.error('X Manage Like API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        output: {
          liked: false,
        },
        error: data.errors?.[0]?.detail ?? 'Failed to manage like',
      }
    }

    return {
      success: true,
      output: {
        liked: data.data?.liked ?? false,
      },
    }
  },

  outputs: {
    liked: {
      type: 'boolean',
      description: 'Whether the tweet is now liked',
    },
  },
}
