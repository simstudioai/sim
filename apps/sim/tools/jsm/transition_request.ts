import type { JsmTransitionRequestParams, JsmTransitionRequestResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmTransitionRequestTool: ToolConfig<
  JsmTransitionRequestParams,
  JsmTransitionRequestResponse
> = {
  id: 'jsm_transition_request',
  name: 'JSM Transition Request',
  description: 'Transition a service request to a new status in Jira Service Management',
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
    transitionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Transition ID to apply',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional comment to add during transition',
    },
  },

  request: {
    url: '/api/tools/jsm/transition',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      issueIdOrKey: params.issueIdOrKey,
      transitionId: params.transitionId,
      comment: params.comment,
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
          transitionId: '',
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
        transitionId: '',
        success: false,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
    transitionId: { type: 'string', description: 'Applied transition ID' },
    success: { type: 'boolean', description: 'Whether the transition was successful' },
  },
}
