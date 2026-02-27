import type { ToolConfig } from '@/tools/types'
import type { XDeleteBookmarkParams, XDeleteBookmarkResponse } from '@/tools/x/types'

export const xDeleteBookmarkTool: ToolConfig<XDeleteBookmarkParams, XDeleteBookmarkResponse> = {
  id: 'x_delete_bookmark',
  name: 'X Delete Bookmark',
  description: "Remove a tweet from the authenticated user's bookmarks",
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
      description: 'The tweet ID to remove from bookmarks',
    },
  },

  request: {
    url: (params) =>
      `https://api.x.com/2/users/${params.userId.trim()}/bookmarks/${params.tweetId.trim()}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        bookmarked: data.data?.bookmarked ?? false,
      },
    }
  },

  outputs: {
    bookmarked: {
      type: 'boolean',
      description: 'Whether the tweet is still bookmarked (should be false after deletion)',
    },
  },
}
