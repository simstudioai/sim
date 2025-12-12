import type { RedditSubscribeParams, RedditWriteResponse } from '@/tools/reddit/types'
import type { ToolConfig } from '@/tools/types'

export const subscribeTool: ToolConfig<RedditSubscribeParams, RedditWriteResponse> = {
  id: 'reddit_subscribe',
  name: 'Subscribe/Unsubscribe from Subreddit',
  description: 'Subscribe or unsubscribe from a subreddit',
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
    subreddit: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the subreddit (without the r/ prefix)',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Action to perform: "sub" to subscribe or "unsub" to unsubscribe',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/subscribe',
    method: 'POST',
    headers: (params: RedditSubscribeParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditSubscribeParams) => {
      // Validate action
      if (!['sub', 'unsub'].includes(params.action)) {
        throw new Error('action must be "sub" or "unsub"')
      }

      // Sanitize subreddit
      const subreddit = params.subreddit.trim().replace(/^r\//, '')

      const formData = new URLSearchParams({
        action: params.action,
        sr_name: subreddit,
      })

      return formData.toString() as unknown as Record<string, any>
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditSubscribeParams) => {
    // Reddit subscribe API returns empty JSON {} on success
    await response.json()

    if (response.ok) {
      const actionText =
        requestParams?.action === 'sub'
          ? `subscribed to r/${requestParams?.subreddit || 'subreddit'}`
          : `unsubscribed from r/${requestParams?.subreddit || 'subreddit'}`

      return {
        success: true,
        output: {
          success: true,
          message: `Successfully ${actionText}`,
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to update subscription',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the subscription action was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}
