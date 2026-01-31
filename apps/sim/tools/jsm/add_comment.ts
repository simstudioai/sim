import type { JsmAddCommentParams, JsmAddCommentResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmAddCommentTool: ToolConfig<JsmAddCommentParams, JsmAddCommentResponse> = {
  id: 'jsm_add_comment',
  name: 'JSM Add Comment',
  description: 'Add a comment (public or internal) to a service request in Jira Service Management',
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
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment body text',
    },
    isPublic: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether the comment is public (visible to customer) or internal (true/false)',
    },
  },

  request: {
    url: '/api/tools/jsm/comment',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      issueIdOrKey: params.issueIdOrKey,
      body: params.body,
      isPublic: params.isPublic,
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
          commentId: '',
          body: '',
          isPublic: false,
          success: false,
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
        commentId: '',
        body: '',
        isPublic: false,
        success: false,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
    commentId: { type: 'string', description: 'Created comment ID' },
    body: { type: 'string', description: 'Comment body text' },
    isPublic: { type: 'boolean', description: 'Whether the comment is public' },
    success: { type: 'boolean', description: 'Whether the comment was added successfully' },
  },
}
