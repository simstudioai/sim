import type { RedditVoteParams, RedditWriteResponse } from '@/tools/reddit/types'
import type { ToolConfig } from '@/tools/types'

export const voteTool: ToolConfig<RedditVoteParams, RedditWriteResponse> = {
  id: 'reddit_vote',
  name: 'Vote on Reddit Post/Comment',
  description: 'Upvote, downvote, or unvote a Reddit post or comment',
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
      description: 'Thing fullname to vote on (e.g., t3_xxxxx for post, t1_xxxxx for comment)',
    },
    dir: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Vote direction: 1 (upvote), 0 (unvote), or -1 (downvote)',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/vote',
    method: 'POST',
    headers: (params: RedditVoteParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditVoteParams) => {
      // Validate dir parameter
      if (![1, 0, -1].includes(params.dir)) {
        throw new Error('dir must be 1 (upvote), 0 (unvote), or -1 (downvote)')
      }

      const formData = new URLSearchParams({
        id: params.id,
        dir: params.dir.toString(),
      })

      return formData.toString() as unknown as Record<string, any>
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditVoteParams) => {
    // Reddit vote API returns empty JSON {} on success
    const data = await response.json()

    if (response.ok) {
      const action =
        requestParams?.dir === 1 ? 'upvoted' : requestParams?.dir === -1 ? 'downvoted' : 'unvoted'

      return {
        success: true,
        output: {
          success: true,
          message: `Successfully ${action} ${requestParams?.id}`,
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to vote',
        data,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the vote was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}
