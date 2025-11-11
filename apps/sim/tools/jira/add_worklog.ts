import type { JiraAddWorklogParams, JiraAddWorklogResponse } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraAddWorklogTool: ToolConfig<JiraAddWorklogParams, JiraAddWorklogResponse> = {
  id: 'jira_add_worklog',
  name: 'Jira Add Worklog',
  description: 'Add a time tracking worklog entry to a Jira issue',
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
      description: 'Jira issue key to add worklog to (e.g., PROJ-123)',
    },
    timeSpentSeconds: {
      type: 'number',
      required: true,
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
      description: 'Optional start time in ISO format (defaults to current time)',
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
    url: (params: JiraAddWorklogParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/worklog`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: (params: JiraAddWorklogParams) => (params.cloudId ? 'POST' : 'GET'),
    headers: (params: JiraAddWorklogParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: JiraAddWorklogParams) => {
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
        started:
          (params.started ? params.started.replace(/Z$/, '+0000') : undefined) ||
          new Date().toISOString().replace(/Z$/, '+0000'),
      }
    },
  },

  transformResponse: async (response: Response, params?: JiraAddWorklogParams) => {
    if (!params?.cloudId) {
      if (!params?.timeSpentSeconds || params.timeSpentSeconds <= 0) {
        throw new Error('timeSpentSeconds is required and must be greater than 0')
      }
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      // Make the actual request with the resolved cloudId
      const worklogUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params?.issueKey}/worklog`
      const worklogResponse = await fetch(worklogUrl, {
        method: 'POST',
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
          // Preserve milliseconds and convert trailing Z to +0000 as required by Jira examples
          started:
            (params?.started ? params.started.replace(/Z$/, '+0000') : undefined) ||
            new Date().toISOString().replace(/Z$/, '+0000'),
        }),
      })

      if (!worklogResponse.ok) {
        let message = `Failed to add worklog to Jira issue (${worklogResponse.status})`
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
          worklogId: data?.id || 'unknown',
          timeSpentSeconds: params?.timeSpentSeconds ? Number(params.timeSpentSeconds) : 0 || 0,
          success: true,
        },
      }
    }

    // If cloudId was provided, process the response
    if (!response.ok) {
      let message = `Failed to add worklog to Jira issue (${response.status})`
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
        worklogId: data?.id || 'unknown',
        timeSpentSeconds: params?.timeSpentSeconds ? Number(params.timeSpentSeconds) : 0 || 0,
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
        'Worklog details with timestamp, issue key, worklog ID, time spent in seconds, and success status',
    },
  },
}
