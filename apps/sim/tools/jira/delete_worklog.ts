import type { JiraDeleteWorklogParams, JiraDeleteWorklogResponse } from '@/tools/jira/types'
import { SUCCESS_OUTPUT, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraDeleteWorklogTool: ToolConfig<JiraDeleteWorklogParams, JiraDeleteWorklogResponse> =
  {
    id: 'jira_delete_worklog',
    name: 'Jira Delete Worklog',
    description: 'Delete a worklog entry from a Jira issue',
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
        description: 'Jira issue key containing the worklog (e.g., PROJ-123)',
      },
      worklogId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the worklog entry to delete',
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
      url: (params: JiraDeleteWorklogParams) => {
        if (params.cloudId) {
          return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/worklog/${params.worklogId}`
        }
        return 'https://api.atlassian.com/oauth/token/accessible-resources'
      },
      method: (params: JiraDeleteWorklogParams) => (params.cloudId ? 'DELETE' : 'GET'),
      headers: (params: JiraDeleteWorklogParams) => {
        return {
          Accept: 'application/json',
          Authorization: `Bearer ${params.accessToken}`,
        }
      },
    },

    transformResponse: async (response: Response, params?: JiraDeleteWorklogParams) => {
      if (!params?.cloudId) {
        const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
        const worklogUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params!.issueKey}/worklog/${params!.worklogId}`
        const worklogResponse = await fetch(worklogUrl, {
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${params!.accessToken}`,
          },
        })

        if (!worklogResponse.ok) {
          let message = `Failed to delete worklog from Jira issue (${worklogResponse.status})`
          try {
            const err = await worklogResponse.json()
            message = err?.errorMessages?.join(', ') || err?.message || message
          } catch (_e) {}
          throw new Error(message)
        }

        return {
          success: true,
          output: {
            ts: new Date().toISOString(),
            issueKey: params!.issueKey || 'unknown',
            worklogId: params!.worklogId || 'unknown',
            success: true,
          },
        }
      }

      if (!response.ok) {
        let message = `Failed to delete worklog from Jira issue (${response.status})`
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
          issueKey: params!.issueKey || 'unknown',
          worklogId: params!.worklogId || 'unknown',
          success: true,
        },
      }
    },

    outputs: {
      ts: TIMESTAMP_OUTPUT,
      success: SUCCESS_OUTPUT,
      issueKey: { type: 'string', description: 'Issue key' },
      worklogId: { type: 'string', description: 'Deleted worklog ID' },
    },
  }
