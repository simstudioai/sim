import type { JsmGetTransitionsParams, JsmGetTransitionsResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmGetTransitionsTool: ToolConfig<JsmGetTransitionsParams, JsmGetTransitionsResponse> =
  {
    id: 'jsm_get_transitions',
    name: 'JSM Get Transitions',
    description: 'Get available transitions for a service request in Jira Service Management',
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
    },

    request: {
      url: '/api/tools/jsm/transitions',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        issueIdOrKey: params.issueIdOrKey,
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
            transitions: [],
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
          transitions: [],
        },
        error: data.error,
      }
    },

    outputs: {
      ts: { type: 'string', description: 'Timestamp of the operation' },
      issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
      transitions: { type: 'json', description: 'Array of available transitions' },
    },
  }
