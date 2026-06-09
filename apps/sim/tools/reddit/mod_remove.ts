import type { ToolConfig, ToolResponse } from '@/tools/types'

interface RedditModRemoveParams {
  accessToken: string
  id: string
  spam?: boolean
}

interface RedditModRemoveResponse extends ToolResponse {
  output: {
    success: boolean
    message?: string
  }
}

export const modRemoveTool: ToolConfig<RedditModRemoveParams, RedditModRemoveResponse> = {
  id: 'reddit_mod_remove',
  name: 'Remove Reddit Post/Comment (Mod)',
  description: 'Remove a Reddit post or comment as a moderator, optionally marking it as spam',
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
      description: 'Thing fullname to remove (e.g., "t3_abc123" for post, "t1_def456" for comment)',
    },
    spam: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mark the item as spam to train the subreddit spam filter (default: false)',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/remove',
    method: 'POST',
    headers: (params: RedditModRemoveParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditModRemoveParams) => {
      const formData = new URLSearchParams({
        id: params.id,
        spam: (params.spam ?? false).toString(),
      })

      return formData.toString()
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditModRemoveParams) => {
    await response.json().catch(() => ({}))

    if (response.ok) {
      const asSpam = requestParams?.spam ? ' as spam' : ''
      return {
        success: true,
        output: {
          success: true,
          message: `Successfully removed ${requestParams?.id}${asSpam}`,
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to remove item',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the removal was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}
