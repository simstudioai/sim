import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XCreateBookmarkParams, XCreateBookmarkResponse } from '@/tools/x/types'

const logger = createLogger('XCreateBookmarkTool')

export const xCreateBookmarkTool: ToolConfig<XCreateBookmarkParams, XCreateBookmarkResponse> = {
  id: 'x_create_bookmark',
  name: 'X Create Bookmark',
  description: 'Bookmark a tweet for the authenticated user',
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
      description: 'The tweet ID to bookmark',
    },
  },

  request: {
    url: (params) => `https://api.x.com/2/users/${params.userId.trim()}/bookmarks`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      tweet_id: params.tweetId.trim(),
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.data) {
      logger.error('X Create Bookmark API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.errors?.[0]?.detail || 'Failed to bookmark tweet',
        output: {
          bookmarked: false,
        },
      }
    }

    return {
      success: true,
      output: {
        bookmarked: data.data.bookmarked ?? false,
      },
    }
  },

  outputs: {
    bookmarked: {
      type: 'boolean',
      description: 'Whether the tweet was successfully bookmarked',
    },
  },
}
