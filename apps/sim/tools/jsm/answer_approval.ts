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
            finalDecision: null,
            approvers: null,
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
          finalDecision: null,
          approvers: null,
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
      id: { type: 'string', description: 'Approval ID from response', optional: true },
      name: { type: 'string', description: 'Approval description', optional: true },
      finalDecision: {
        type: 'string',
        description: 'Final approval decision: pending, approved, or declined',
        optional: true,
      },
      canAnswerApproval: {
        type: 'boolean',
        description: 'Whether the current user can still respond',
        optional: true,
      },
      approvers: {
        type: 'array',
        description: 'Updated list of approvers with decisions',
        items: {
          type: 'object',
          properties: {
            approver: {
              type: 'object',
              description: 'Approver user details',
              properties: {
                accountId: { type: 'string', description: 'Approver account ID' },
                displayName: { type: 'string', description: 'Approver display name' },
                emailAddress: { type: 'string', description: 'Approver email', optional: true },
                active: {
                  type: 'boolean',
                  description: 'Whether the account is active',
                  optional: true,
                },
              },
            },
            approverDecision: { type: 'string', description: 'Individual approver decision' },
          },
        },
        optional: true,
      },
      createdDate: { type: 'json', description: 'Approval creation date', optional: true },
      completedDate: { type: 'json', description: 'Approval completion date', optional: true },
      approval: {
        type: 'json',
        description: 'The approval object',
        optional: true,
      },
      success: { type: 'boolean', description: 'Whether the operation succeeded' },
    },
  }
