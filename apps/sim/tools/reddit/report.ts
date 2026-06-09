import type { ToolConfig, ToolResponse } from '@/tools/types'

interface RedditReportParams {
  thing_id: string
  reason?: string
  other_reason?: string
  accessToken?: string
}

interface RedditReportResponse extends ToolResponse {
  output: {
    success: boolean
    message?: string
  }
}

export const reportTool: ToolConfig<RedditReportParams, RedditReportResponse> = {
  id: 'reddit_report',
  name: 'Report Reddit Post/Comment',
  description: 'Report a Reddit post or comment to subreddit moderators for a rules violation',
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
    thing_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Thing fullname to report (e.g., "t3_abc123" for post, "t1_def456" for comment)',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for reporting (max 100 characters)',
    },
    other_reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form custom reason for reporting (max 100 characters)',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/report',
    method: 'POST',
    headers: (params: RedditReportParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params: RedditReportParams) => {
      const formData = new URLSearchParams({
        thing_id: params.thing_id,
        api_type: 'json',
      })

      if (params.reason) {
        formData.append('reason', params.reason)
      }

      if (params.other_reason) {
        formData.append('other_reason', params.other_reason)
      }

      return formData.toString()
    },
  },

  transformResponse: async (response: Response, requestParams?: RedditReportParams) => {
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
          message: `Failed to report: ${errors}`,
        },
      }
    }

    return {
      success: true,
      output: {
        success: true,
        message: `Successfully reported ${requestParams?.thing_id}`,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the report was successful',
    },
    message: {
      type: 'string',
      description: 'Success or error message',
    },
  },
}
