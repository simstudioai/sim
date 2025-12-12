import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface JiraAssignIssueParams {
  accessToken: string
  domain: string
  issueKey: string
  accountId: string
  cloudId?: string
}

export interface JiraAssignIssueResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    assigneeId: string
    success: boolean
  }
}

export const jiraAssignIssueTool: ToolConfig<JiraAssignIssueParams, JiraAssignIssueResponse> = {
  id: 'jira_assign_issue',
  name: 'Jira Assign Issue',
  description: 'Assign a Jira issue to a user',
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
      description: 'OAuth access token for Jira',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    issueKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Jira issue key to assign (e.g., PROJ-123)',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Account ID of the user to assign the issue to. Use "-1" for automatic assignment or null to unassign.',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: JiraAssignIssueParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/assignee`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: (params: JiraAssignIssueParams) => (params.cloudId ? 'PUT' : 'GET'),
    headers: (params: JiraAssignIssueParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: JiraAssignIssueParams) => {
      if (!params.cloudId) return undefined as any
      return {
        accountId: params.accountId === 'null' ? null : params.accountId,
      }
    },
  },

  transformResponse: async (response: Response, params?: JiraAssignIssueParams) => {
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      const assignUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params!.issueKey}/assignee`
      const assignResponse = await fetch(assignUrl, {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
        body: JSON.stringify({
          accountId: params!.accountId === 'null' ? null : params!.accountId,
        }),
      })

      if (!assignResponse.ok) {
        let message = `Failed to assign Jira issue (${assignResponse.status})`
        try {
          const err = await assignResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: params?.issueKey || 'unknown',
          assigneeId: params?.accountId || 'unknown',
          success: true,
        },
      }
    }

    if (!response.ok) {
      let message = `Failed to assign Jira issue (${response.status})`
      try {
        const err = await response.json()
        message = err?.errorMessages?.join(', ') || err?.message || message
      } catch (_e) {}
      throw new Error(message)
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: params?.issueKey || 'unknown',
        assigneeId: params?.accountId || 'unknown',
        success: true,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Operation success status',
    },
    output: {
      type: 'object',
      description: 'Assignment details with timestamp, issue key, assignee ID, and success status',
    },
  },
}
