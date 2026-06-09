import type { ToolConfig, ToolResponse } from '@/tools/types'

type RedditDistinguishHow = 'yes' | 'no' | 'admin' | 'special'

interface RedditModDistinguishParams {
  accessToken: string
  id: string
  how: RedditDistinguishHow
  sticky?: boolean
}

interface RedditModDistinguishResponse extends ToolResponse {
  output: {
    success: boolean
    message?: string
  }
}

const ALLOWED_HOW: RedditDistinguishHow[] = ['yes', 'no', 'admin', 'special']

export const modDistinguishTool: ToolConfig<
  RedditModDistinguishParams,
  RedditModDistinguishResponse
> = {
  id: 'reddit_mod_distinguish',
  name: 'Distinguish Reddit Post/Comment (Mod)',
  description: 'Distinguish or un-distinguish a Reddit post or comment as a moderator',
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
        'Thing fullname to distinguish (e.g., "t3_abc123" for post, "t1_def456" for comment)',
    },
    how: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Distinguish type: "yes" (moderator), "no" (remove distinction), "admin", or "special"',
    },
    sticky: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sticky the comment to the top of the comment page (comments only)',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/distinguish',
    method: 'POST',
    headers: (params: RedditModDistinguishParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditModDistinguishParams) => {
      if (!ALLOWED_HOW.includes(params.how)) {
        throw new Error('how must be one of "yes", "no", "admin", or "special"')
      }

      const formData = new URLSearchParams({
        id: params.id,
        how: params.how,
        api_type: 'json',
      })

      if (params.sticky !== undefined) {
        formData.append('sticky', params.sticky.toString())
      }

      return formData.toString()
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditModDistinguishParams) => {
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
          message: `Failed to distinguish item: ${errors}`,
        },
      }
    }

    return {
      success: true,
      output: {
        success: true,
        message: `Successfully distinguished ${requestParams?.id}`,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the distinguish action was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}
