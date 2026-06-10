import type { ToolConfig, ToolResponse } from '@/tools/types'

interface RedditModApproveParams {
  accessToken: string
  id: string
}

interface RedditModApproveResponse extends ToolResponse {
  output: {
    success: boolean
    message?: string
  }
}

export const modApproveTool: ToolConfig<RedditModApproveParams, RedditModApproveResponse> = {
  id: 'reddit_mod_approve',
  name: 'Approve Reddit Post/Comment (Mod)',
  description: 'Approve a reported or removed Reddit post or comment as a moderator',
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
        'Thing fullname to approve (e.g., "t3_abc123" for post, "t1_def456" for comment)',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/approve',
    method: 'POST',
    headers: (params: RedditModApproveParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditModApproveParams) => {
      const formData = new URLSearchParams({
        id: params.id,
      })

      return formData.toString()
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditModApproveParams) => {
    await response.json().catch(() => ({}))

    if (response.ok) {
      return {
        success: true,
        output: {
          success: true,
          message: `Successfully approved ${requestParams?.id}`,
        },
      }
    }

    return {
      success: false,
      output: {
        success: false,
        message: 'Failed to approve item',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the approval was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}
