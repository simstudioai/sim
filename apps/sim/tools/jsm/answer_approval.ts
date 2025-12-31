import type { JsmAnswerApprovalParams, JsmAnswerApprovalResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmAnswerApprovalTool: ToolConfig<JsmAnswerApprovalParams, JsmAnswerApprovalResponse> =
  {
    id: 'jsm_answer_approval',
    name: 'JSM Answer Approval',
    description: 'Approve or decline an approval request in Jira Service Management',
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
      approvalId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Approval ID to answer',
      },
      decision: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Decision: "approve" or "decline"',
      },
    },

    request: {
      url: '/api/tools/jsm/approvals',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        issueIdOrKey: params.issueIdOrKey,
        approvalId: params.approvalId,
        decision: params.decision,
        action: 'answer',
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
            approvalId: '',
            decision: '',
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
          approvalId: '',
          decision: '',
          success: false,
        },
        error: data.error,
      }
    },

    outputs: {
      ts: { type: 'string', description: 'Timestamp of the operation' },
      issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
      approvalId: { type: 'string', description: 'Approval ID' },
      decision: { type: 'string', description: 'Decision made (approve/decline)' },
      success: { type: 'boolean', description: 'Whether the operation succeeded' },
    },
  }
