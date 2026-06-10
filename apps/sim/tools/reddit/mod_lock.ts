import type { ToolConfig, ToolResponse } from '@/tools/types'

interface RedditLockParams {
  accessToken: string
  id: string
}

interface RedditLockResponse extends ToolResponse {
  output: {
    success: boolean
    message?: string
  }
}

export const lockTool: ToolConfig<RedditLockParams, RedditLockResponse> = {
  id: 'reddit_lock',
  name: 'Lock Reddit Post/Comment (Mod)',
  description: 'Lock a Reddit post or comment to prevent further replies (moderator action)',
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
      description: 'Thing fullname to lock (e.g., "t3_abc123" for post, "t1_def456" for comment)',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/lock',
    method: 'POST',
    headers: (params: RedditLockParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditLockParams) => {
      const formData = new URLSearchParams({
        id: params.id,
      })

      return formData.toString()
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditLockParams) => {
    await response.json().catch(() => ({}))

    if (response.ok) {
      return {
        success: true,
        output: {
          success: true,
          message: `Successfully locked ${requestParams?.id}`,
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to lock item',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the lock was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}

export const unlockTool: ToolConfig<RedditLockParams, RedditLockResponse> = {
  id: 'reddit_unlock',
  name: 'Unlock Reddit Post/Comment (Mod)',
  description: 'Unlock a Reddit post or comment to allow replies again (moderator action)',
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
      description: 'Thing fullname to unlock (e.g., "t3_abc123" for post, "t1_def456" for comment)',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/unlock',
    method: 'POST',
    headers: (params: RedditLockParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditLockParams) => {
      const formData = new URLSearchParams({
        id: params.id,
      })

      return formData.toString()
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditLockParams) => {
    await response.json().catch(() => ({}))

    if (response.ok) {
      return {
        success: true,
        output: {
          success: true,
          message: `Successfully unlocked ${requestParams?.id}`,
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to unlock item',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the unlock was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}
