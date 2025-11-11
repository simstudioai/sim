import type { RedditSubmitParams, RedditWriteResponse } from '@/tools/reddit/types'
import type { ToolConfig } from '@/tools/types'

export const submitPostTool: ToolConfig<RedditSubmitParams, RedditWriteResponse> = {
  id: 'reddit_submit_post',
  name: 'Submit Reddit Post',
  description: 'Submit a new post to a subreddit (text or link)',
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
      description: 'The name of the subreddit to post to (without the r/ prefix)',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the submission (max 300 characters)',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Text content for a self post (markdown supported)',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL for a link post (cannot be used with text)',
    },
    nsfw: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mark post as NSFW',
    },
    spoiler: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mark post as spoiler',
    },
    send_replies: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Send reply notifications to inbox (default: true)',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/submit',
    method: 'POST',
    headers: (params: RedditSubmitParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditSubmitParams) => {
      // Sanitize subreddit
      const subreddit = params.subreddit.trim().replace(/^r\//, '')

      // Build form data
      const formData = new URLSearchParams({
        sr: subreddit,
        title: params.title,
        api_type: 'json',
      })

      // Determine post kind (self or link)
      if (params.text) {
        formData.append('kind', 'self')
        formData.append('text', params.text)
      } else if (params.url) {
        formData.append('kind', 'link')
        formData.append('url', params.url)
      } else {
        formData.append('kind', 'self')
        formData.append('text', '')
      }

      // Add optional parameters
      if (params.nsfw !== undefined) formData.append('nsfw', params.nsfw.toString())
      if (params.spoiler !== undefined) formData.append('spoiler', params.spoiler.toString())
      if (params.send_replies !== undefined)
        formData.append('sendreplies', params.send_replies.toString())

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
          message: `Failed to submit post: ${errors}`,
        },
      }
    }

    // Success response includes post data
    const postData = data.json?.data
    return {
      success: true,
      output: {
        success: true,
        message: 'Post submitted successfully',
        data: {
          id: postData?.id,
          name: postData?.name,
          url: postData?.url,
          permalink: `https://www.reddit.com${postData?.url}`,
        },
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the post was submitted successfully',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
    data: {
      type: 'object',
      description: 'Post data including ID, name, URL, and permalink',
    },
  },
}
