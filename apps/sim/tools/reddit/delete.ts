import type { RedditDeleteParams, RedditWriteResponse } from '@/tools/reddit/types'
import type { ToolConfig } from '@/tools/types'

export const deleteTool: ToolConfig<RedditDeleteParams, RedditWriteResponse> = {
  id: 'reddit_delete',
  name: 'Delete Reddit Post/Comment',
  description: 'Delete your own Reddit post or comment',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'reddit',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Reddit API',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Thing fullname to delete (e.g., t3_xxxxx for post, t1_xxxxx for comment)',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/del',
    method: 'POST',
    headers: (params: RedditDeleteParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditDeleteParams) => {
      const formData = new URLSearchParams({
        id: params.id,
      })

      return {
        body: formData.toString(),
      }
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditDeleteParams) => {
    // Reddit delete API returns empty JSON {} on success
    await response.json()

    if (response.ok) {
      return {
        success: true,
        output: {
          success: true,
          message: `Successfully deleted ${requestParams?.id}`,
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to delete item',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the deletion was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}
