import type { JsmGetCommentsParams, JsmGetCommentsResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmGetCommentsTool: ToolConfig<JsmGetCommentsParams, JsmGetCommentsResponse> = {
  id: 'jsm_get_comments',
  name: 'JSM Get Comments',
  description: 'Get comments for a service request in Jira Service Management',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Jira Service Management',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Jira Cloud ID for the instance',
    },
    issueIdOrKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Issue ID or key (e.g., SD-123)',
    },
    isPublic: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter to only public comments (true/false)',
    },
    internal: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter to only internal comments (true/false)',
    },
    start: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start index for pagination (e.g., 0, 50, 100)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results to return (e.g., 10, 25, 50)',
    },
  },

  request: {
    url: '/api/tools/jsm/comments',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      issueIdOrKey: params.issueIdOrKey,
      isPublic: params.isPublic,
      internal: params.internal,
      start: params.start,
      limit: params.limit,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey: '',
          comments: [],
          total: 0,
          isLastPage: true,
        },
        error: 'Empty response from API',
      }
    }

    const data = JSON.parse(responseText)

    if (data.success && data.output) {
      return data
    }

    return {
      success: data.success || false,
      output: data.output || {
        ts: new Date().toISOString(),
        issueIdOrKey: '',
        comments: [],
        total: 0,
        isLastPage: true,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
    comments: { type: 'json', description: 'Array of comments' },
    total: { type: 'number', description: 'Total number of comments' },
    isLastPage: { type: 'boolean', description: 'Whether this is the last page' },
  },
}
