import type { JsmAddParticipantsParams, JsmAddParticipantsResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmAddParticipantsTool: ToolConfig<
  JsmAddParticipantsParams,
  JsmAddParticipantsResponse
> = {
  id: 'jsm_add_participants',
  name: 'JSM Add Participants',
  description: 'Add participants to a request in Jira Service Management',
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
    accountIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated account IDs to add as participants',
    },
  },

  request: {
    url: '/api/tools/jsm/participants',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      issueIdOrKey: params.issueIdOrKey,
      accountIds: params.accountIds,
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
          participants: [],
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
        participants: [],
        success: false,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
    participants: { type: 'json', description: 'Array of added participants' },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
  },
}
