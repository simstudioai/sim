import type { RedditSendMessageParams, RedditWriteResponse } from '@/tools/reddit/types'
import type { ToolConfig } from '@/tools/types'

export const sendMessageTool: ToolConfig<RedditSendMessageParams, RedditWriteResponse> = {
  id: 'reddit_send_message',
  name: 'Send Reddit Message',
  description: 'Send a private message to a Reddit user',
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
    to: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient username (e.g., "example_user") or subreddit (e.g., "/r/subreddit")',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message subject (max 100 characters)',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message body in markdown format',
    },
    from_sr: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subreddit name to send the message from (requires moderator mail permission)',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/compose',
    method: 'POST',
    headers: (params: RedditSendMessageParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditSendMessageParams) => {
      const formData = new URLSearchParams({
        to: params.to.trim(),
        subject: params.subject,
        text: params.text,
        api_type: 'json',
      })

      if (params.from_sr) {
        formData.append('from_sr', params.from_sr.trim())
      }

      return formData.toString() as unknown as Record<string, any>
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      const errorMsg = data?.message || `HTTP error ${response.status}`
      return {
        success: false,
        output: {
          success: false,
          message: `Failed to send message: ${errorMsg}`,
        },
      }
    }

    if (data.json?.errors && data.json.errors.length > 0) {
      const errors = data.json.errors.map((err: any) => err.join(': ')).join(', ')
      return {
        success: false,
        output: {
          success: false,
          message: `Failed to send message: ${errors}`,
        },
      }
    }

    return {
      success: true,
      output: {
        success: true,
        message: 'Message sent successfully',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the message was sent successfully',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}
