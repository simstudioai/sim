import type { ToolConfig, ToolResponse } from '@/tools/types'

interface RedditMarkReadParams {
  id: string
  accessToken?: string
}

interface RedditMarkAllReadParams {
  accessToken?: string
}

interface RedditMarkMessageResponse extends ToolResponse {
  output: {
    success: boolean
    message?: string
  }
}

export const markReadTool: ToolConfig<RedditMarkReadParams, RedditMarkMessageResponse> = {
  id: 'reddit_mark_read',
  name: 'Mark Reddit Messages Read',
  description: 'Mark one or more private messages as read',
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
      description:
        'Comma-separated list of message fullnames to mark read (e.g., "t4_abc123,t4_def456")',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/read_message',
    method: 'POST',
    headers: (params: RedditMarkReadParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditMarkReadParams) => {
      const formData = new URLSearchParams({
        id: params.id,
      })

      return formData.toString()
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditMarkReadParams) => {
    await response.json().catch(() => ({}))

    if (response.ok) {
      return {
        success: true,
        output: {
          success: true,
          message: `Successfully marked ${requestParams?.id} as read`,
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to mark messages as read',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the operation was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}

export const markAllReadTool: ToolConfig<RedditMarkAllReadParams, RedditMarkMessageResponse> = {
  id: 'reddit_mark_all_read',
  name: 'Mark All Reddit Messages Read',
  description: 'Mark all private messages in the inbox as read',
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
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/read_all_messages',
    method: 'POST',
    headers: (params: RedditMarkAllReadParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: () => '',
  },

  transformResponse: async (response: Response) => {
    if (response.ok) {
      return {
        success: true,
        output: {
          success: true,
          message: 'Successfully marked all messages as read',
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to mark all messages as read',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the operation was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}
