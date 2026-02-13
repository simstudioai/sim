import type { JsmAddFeedbackParams, JsmAddFeedbackResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmAddFeedbackTool: ToolConfig<JsmAddFeedbackParams, JsmAddFeedbackResponse> = {
  id: 'jsm_add_feedback',
  name: 'JSM Add Feedback',
  description: 'Add CSAT feedback to a service request in Jira Service Management',
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
    rating: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'CSAT rating (1-5)',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional feedback comment',
    },
  },

  request: {
    url: '/api/tools/jsm/feedback',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      issueIdOrKey: params.issueIdOrKey,
      rating: params.rating,
      comment: params.comment,
      action: 'add',
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
          rating: 0,
          comment: null,
          type: '',
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
        rating: 0,
        comment: null,
        type: '',
        success: false,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
    rating: { type: 'number', description: 'CSAT rating submitted' },
    comment: { type: 'string', description: 'Feedback comment', optional: true },
    type: { type: 'string', description: 'Feedback type' },
    success: { type: 'boolean', description: 'Whether feedback was submitted successfully' },
  },
}
