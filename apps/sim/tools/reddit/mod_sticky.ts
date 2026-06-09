import type { ToolConfig, ToolResponse } from '@/tools/types'

interface RedditModStickyParams {
  accessToken: string
  id: string
  state: boolean
  num?: number
}

interface RedditModStickyResponse extends ToolResponse {
  output: {
    success: boolean
    message?: string
  }
}

export const modStickyTool: ToolConfig<RedditModStickyParams, RedditModStickyResponse> = {
  id: 'reddit_mod_sticky',
  name: 'Sticky Reddit Post (Mod)',
  description: 'Sticky or unsticky a Reddit post to the top of a subreddit (moderator action)',
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
      description: 'Post fullname to sticky/unsticky (e.g., "t3_abc123")',
    },
    state: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'true to sticky the post, false to unsticky it',
    },
    num: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sticky slot to use, 1-4 (1 is the top slot). Only applies when stickying',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/set_subreddit_sticky',
    method: 'POST',
    headers: (params: RedditModStickyParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditModStickyParams) => {
      if (typeof params.state !== 'boolean') {
        throw new Error('state must be a boolean (true to sticky, false to unsticky)')
      }

      const formData = new URLSearchParams({
        id: params.id,
        state: params.state.toString(),
        api_type: 'json',
      })

      if (params.num !== undefined) {
        if (params.num < 1 || params.num > 4) {
          throw new Error('num must be between 1 and 4')
        }
        formData.append('num', params.num.toString())
      }

      return formData.toString()
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditModStickyParams) => {
    const data = await response.json().catch(() => ({}) as any)

    if (!response.ok) {
      return {
        success: false,
        output: {
          success: false,
          message: `HTTP error ${response.status}`,
        },
      }
    }

    if (data.json?.errors && data.json.errors.length > 0) {
      const errors = data.json.errors.map((err: string[]) => err.join(': ')).join(', ')
      return {
        success: false,
        output: {
          success: false,
          message: `Failed to set sticky: ${errors}`,
        },
      }
    }

    const action = requestParams?.state ? 'stickied' : 'unstickied'
    return {
      success: true,
      output: {
        success: true,
        message: `Successfully ${action} ${requestParams?.id}`,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the sticky action was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}
