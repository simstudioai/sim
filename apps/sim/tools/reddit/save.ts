import type { RedditSaveParams, RedditWriteResponse } from '@/tools/reddit/types'
import type { ToolConfig } from '@/tools/types'

export const saveTool: ToolConfig<RedditSaveParams, RedditWriteResponse> = {
  id: 'reddit_save',
  name: 'Save Reddit Post/Comment',
  description: 'Save a Reddit post or comment to your saved items',
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
      description: 'Thing fullname to save (e.g., t3_xxxxx for post, t1_xxxxx for comment)',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Category to save under (Reddit Gold feature)',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/save',
    method: 'POST',
    headers: (params: RedditSaveParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditSaveParams) => {
      const formData = new URLSearchParams({
        id: params.id,
      })

      if (params.category) {
        formData.append('category', params.category)
      }

      return formData.toString() as unknown as Record<string, any>
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditSaveParams) => {
    // Reddit save API returns empty JSON {} on success
    await response.json()

    if (response.ok) {
      return {
        success: true,
        output: {
          success: true,
          message: `Successfully saved ${requestParams?.id}`,
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to save item',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the save was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}

export const unsaveTool: ToolConfig<RedditSaveParams, RedditWriteResponse> = {
  id: 'reddit_unsave',
  name: 'Unsave Reddit Post/Comment',
  description: 'Remove a Reddit post or comment from your saved items',
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
      description: 'Thing fullname to unsave (e.g., t3_xxxxx for post, t1_xxxxx for comment)',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/unsave',
    method: 'POST',
    headers: (params: RedditSaveParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditSaveParams) => {
      const formData = new URLSearchParams({
        id: params.id,
      })

      return formData.toString() as unknown as Record<string, any>
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditSaveParams) => {
    // Reddit unsave API returns empty JSON {} on success
    await response.json()

    if (response.ok) {
      return {
        success: true,
        output: {
          success: true,
          message: `Successfully unsaved ${requestParams?.id}`,
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to unsave item',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the unsave was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}
