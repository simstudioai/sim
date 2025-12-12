import type { RedditReplyParams, RedditWriteResponse } from '@/tools/reddit/types'
import type { ToolConfig } from '@/tools/types'

export const replyTool: ToolConfig<RedditReplyParams, RedditWriteResponse> = {
  id: 'reddit_reply',
  name: 'Reply to Reddit Post/Comment',
  description: 'Add a comment reply to a Reddit post or comment',
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
    parent_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Thing fullname to reply to (e.g., t3_xxxxx for post, t1_xxxxx for comment)',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment text in markdown format',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/comment',
    method: 'POST',
    headers: (params: RedditReplyParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditReplyParams) => {
      const formData = new URLSearchParams({
        thing_id: params.parent_id,
        text: params.text,
        api_type: 'json',
      })

      return formData.toString() as unknown as Record<string, any>
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // Reddit API returns errors in json.errors array
    if (data.json?.errors && data.json.errors.length > 0) {
      const errors = data.json.errors.map((err: any) => err.join(': ')).join(', ')
      return {
        success: false,
        output: {
          success: false,
          message: `Failed to post reply: ${errors}`,
        },
      }
    }

    // Success response includes comment data
    const commentData = data.json?.data?.things?.[0]?.data
    return {
      success: true,
      output: {
        success: true,
        message: 'Reply posted successfully',
        data: {
          id: commentData?.id,
          name: commentData?.name,
          permalink: commentData?.permalink
            ? `https://www.reddit.com${commentData.permalink}`
            : undefined,
          body: commentData?.body,
        },
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the reply was posted successfully',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
    data: {
      type: 'object',
      description: 'Comment data including ID, name, permalink, and body',
    },
  },
}
