import type { ToolConfig, ToolResponse } from '@/tools/types'

interface RedditHideParams {
  id: string
  accessToken?: string
}

interface RedditHideResponse extends ToolResponse {
  output: {
    success: boolean
    message?: string
  }
}

export const hideTool: ToolConfig<RedditHideParams, RedditHideResponse> = {
  id: 'reddit_hide',
  name: 'Hide Reddit Post',
  description: 'Hide one or more Reddit posts from your listings',
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
      description: 'Comma-separated list of post fullnames to hide (e.g., "t3_abc123,t3_def456")',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/hide',
    method: 'POST',
    headers: (params: RedditHideParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditHideParams) => {
      const formData = new URLSearchParams({
        id: params.id,
      })

      return formData.toString()
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditHideParams) => {
    await response.json().catch(() => ({}))

    if (response.ok) {
      return {
        success: true,
        output: {
          success: true,
          message: `Successfully hid ${requestParams?.id}`,
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to hide post',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the hide was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}

export const unhideTool: ToolConfig<RedditHideParams, RedditHideResponse> = {
  id: 'reddit_unhide',
  name: 'Unhide Reddit Post',
  description: 'Unhide one or more previously hidden Reddit posts',
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
      description: 'Comma-separated list of post fullnames to unhide (e.g., "t3_abc123,t3_def456")',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/unhide',
    method: 'POST',
    headers: (params: RedditHideParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditHideParams) => {
      const formData = new URLSearchParams({
        id: params.id,
      })

      return formData.toString()
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditHideParams) => {
    await response.json().catch(() => ({}))

    if (response.ok) {
      return {
        success: true,
        output: {
          success: true,
          message: `Successfully unhid ${requestParams?.id}`,
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to unhide post',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the unhide was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}
