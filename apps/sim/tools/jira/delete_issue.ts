import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface JiraDeleteIssueParams {
  accessToken: string
  domain: string
  issueKey: string
  cloudId?: string
  deleteSubtasks?: boolean
}

export interface JiraDeleteIssueResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    success: boolean
  }
}

export const jiraDeleteIssueTool: ToolConfig<JiraDeleteIssueParams, JiraDeleteIssueResponse> = {
  id: 'jira_delete_issue',
  name: 'Jira Delete Issue',
  description: 'Delete a Jira issue',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
    additionalScopes: ['delete:issue:jira', 'read:jira-work'],
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
      description: 'Jira issue key to delete (e.g., PROJ-123)',
    },
    deleteSubtasks: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to delete subtasks. If false, parent issues with subtasks cannot be deleted.',
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
    url: (params: JiraDeleteIssueParams) => {
      if (params.cloudId) {
        const deleteSubtasksParam = params.deleteSubtasks ? '?deleteSubtasks=true' : ''
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}${deleteSubtasksParam}`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'DELETE',
    headers: (params: JiraDeleteIssueParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params?: JiraDeleteIssueParams) => {
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      const deleteSubtasksParam = params!.deleteSubtasks ? '?deleteSubtasks=true' : ''
      const deleteUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params!.issueKey}${deleteSubtasksParam}`
      const deleteResponse = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })

      if (!deleteResponse.ok) {
        let message = `Failed to delete Jira issue (${deleteResponse.status})`
        try {
          const err = await deleteResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: params?.issueKey || 'unknown',
          success: true,
        },
      }
    }

    if (!response.ok) {
      let message = `Failed to delete Jira issue (${response.status})`
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
      description: 'Deleted issue details with timestamp, issue key, and success status',
    },
  },
}
