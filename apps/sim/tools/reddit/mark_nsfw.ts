import type { ToolConfig, ToolResponse } from '@/tools/types'

interface RedditMarkNsfwParams {
  id: string
  accessToken?: string
}

interface RedditMarkNsfwResponse extends ToolResponse {
  output: {
    success: boolean
    message?: string
  }
}

export const markNsfwTool: ToolConfig<RedditMarkNsfwParams, RedditMarkNsfwResponse> = {
  id: 'reddit_marknsfw',
  name: 'Mark Reddit Post NSFW',
  description: 'Mark a Reddit post as NSFW (not safe for work)',
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
      description: 'Post fullname to mark as NSFW (e.g., "t3_abc123")',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/marknsfw',
    method: 'POST',
    headers: (params: RedditMarkNsfwParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditMarkNsfwParams) => {
      const formData = new URLSearchParams({
        id: params.id,
      })

      return formData.toString()
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditMarkNsfwParams) => {
    await response.json().catch(() => ({}))

    if (response.ok) {
      return {
        success: true,
        output: {
          success: true,
          message: `Successfully marked ${requestParams?.id} as NSFW`,
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to mark post as NSFW',
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

export const unmarkNsfwTool: ToolConfig<RedditMarkNsfwParams, RedditMarkNsfwResponse> = {
  id: 'reddit_unmarknsfw',
  name: 'Unmark Reddit Post NSFW',
  description: 'Remove the NSFW (not safe for work) mark from a Reddit post',
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
      description: 'Post fullname to unmark as NSFW (e.g., "t3_abc123")',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/unmarknsfw',
    method: 'POST',
    headers: (params: RedditMarkNsfwParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditMarkNsfwParams) => {
      const formData = new URLSearchParams({
        id: params.id,
      })

      return formData.toString()
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditMarkNsfwParams) => {
    await response.json().catch(() => ({}))

    if (response.ok) {
      return {
        success: true,
        output: {
          success: true,
          message: `Successfully unmarked ${requestParams?.id} as NSFW`,
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to unmark post as NSFW',
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
