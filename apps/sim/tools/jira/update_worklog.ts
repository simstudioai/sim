import type { JiraUpdateWorklogParams, JiraUpdateWorklogResponse } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraUpdateWorklogTool: ToolConfig<JiraUpdateWorklogParams, JiraUpdateWorklogResponse> =
  {
    id: 'jira_update_worklog',
    name: 'Jira Update Worklog',
    description: 'Update an existing worklog entry on a Jira issue',
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
        description: 'ID of the worklog entry to update',
      },
      timeSpentSeconds: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Time spent in seconds',
      },
      comment: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional comment for the worklog entry',
      },
      started: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional start time in ISO format',
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
      url: (params: JiraUpdateWorklogParams) => {
        if (params.cloudId) {
          return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/worklog/${params.worklogId}`
        }
        return 'https://api.atlassian.com/oauth/token/accessible-resources'
      },
      method: (params: JiraUpdateWorklogParams) => (params.cloudId ? 'PUT' : 'GET'),
      headers: (params: JiraUpdateWorklogParams) => {
        return {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.accessToken}`,
        }
      },
      body: (params: JiraUpdateWorklogParams) => {
        if (!params.cloudId) return undefined as any
        return {
          timeSpentSeconds: Number(params.timeSpentSeconds),
          comment: params.comment
            ? {
                type: 'doc',
                version: 1,
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: params.comment,
                      },
                    ],
                  },
                ],
              }
            : undefined,
          started: params.started,
        }
      },
    },

    transformResponse: async (response: Response, params?: JiraUpdateWorklogParams) => {
      if (!params?.cloudId) {
        const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
        // Make the actual request with the resolved cloudId
        const worklogUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params?.issueKey}/worklog/${params?.worklogId}`
        const worklogResponse = await fetch(worklogUrl, {
          method: 'PUT',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params?.accessToken}`,
          },
          body: JSON.stringify({
            timeSpentSeconds: params?.timeSpentSeconds ? Number(params.timeSpentSeconds) : 0,
            comment: params?.comment
              ? {
                  type: 'doc',
                  version: 1,
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        {
                          type: 'text',
                          text: params.comment,
                        },
                      ],
                    },
                  ],
                }
              : undefined,
            started: params?.started,
          }),
        })

        if (!worklogResponse.ok) {
          let message = `Failed to update worklog on Jira issue (${worklogResponse.status})`
          try {
            const err = await worklogResponse.json()
            message = err?.errorMessages?.join(', ') || err?.message || message
          } catch (_e) {}
          throw new Error(message)
        }

        const data = await worklogResponse.json()

        return {
          success: true,
          output: {
            ts: new Date().toISOString(),
            issueKey: params?.issueKey || 'unknown',
            worklogId: data?.id || params?.worklogId || 'unknown',
            success: true,
          },
        }
      }

      // If cloudId was provided, process the response
      if (!response.ok) {
        let message = `Failed to update worklog on Jira issue (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: params?.issueKey || 'unknown',
          worklogId: data?.id || params?.worklogId || 'unknown',
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
        description:
          'Worklog update details with timestamp, issue key, worklog ID, and success status',
      },
    },
  }
