import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XDeleteTweetParams, XDeleteTweetResponse } from '@/tools/x/types'

const logger = createLogger('XDeleteTweetTool')

export const xDeleteTweetTool: ToolConfig<XDeleteTweetParams, XDeleteTweetResponse> = {
  id: 'x_delete_tweet',
  name: 'X Delete Tweet',
  description: 'Delete a tweet authored by the authenticated user',
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
    tweetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the tweet to delete',
    },
  },

  request: {
    url: (params) => `https://api.x.com/2/tweets/${params.tweetId.trim()}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.data) {
      logger.error('X Delete Tweet API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.errors?.[0]?.detail || 'Failed to delete tweet',
        output: {
          deleted: false,
        },
      }
    }

    return {
      success: true,
      output: {
        deleted: data.data.deleted ?? false,
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the tweet was successfully deleted',
    },
  },
}
