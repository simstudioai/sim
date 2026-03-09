import type { JiraUpdateWorklogParams, JiraUpdateWorklogResponse } from '@/tools/jira/types'
import { SUCCESS_OUTPUT, TIMESTAMP_OUTPUT, USER_OUTPUT_PROPERTIES } from '@/tools/jira/types'
import { extractAdfText, getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

function buildWorklogBody(params: JiraUpdateWorklogParams) {
  const body: Record<string, any> = {
    timeSpentSeconds: params.timeSpentSeconds ? Number(params.timeSpentSeconds) : undefined,
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
    started: params.started ? params.started.replace(/Z$/, '+0000') : undefined,
  }
  if (params.visibility) body.visibility = params.visibility
  return body
}

function transformWorklogResponse(data: any, params: JiraUpdateWorklogParams) {
  return {
    ts: new Date().toISOString(),
    issueKey: params.issueKey || 'unknown',
    worklogId: data?.id || params.worklogId || 'unknown',
    timeSpent: data?.timeSpent ?? null,
    timeSpentSeconds: data?.timeSpentSeconds ?? null,
    comment: data?.comment ? extractAdfText(data.comment) : null,
    author: data?.author ? transformUser(data.author) : null,
    updateAuthor: data?.updateAuthor ? transformUser(data.updateAuthor) : null,
    started: data?.started || null,
    created: data?.created || null,
    updated: data?.updated || null,
    success: true,
  }
}

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
      visibility: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Restrict worklog visibility. Object with "type" ("role" or "group") and "value" (role/group name).',
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
        return buildWorklogBody(params)
      },
    },

    transformResponse: async (response: Response, params?: JiraUpdateWorklogParams) => {
      if (!params?.cloudId) {
        const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
        const worklogUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params!.issueKey}/worklog/${params!.worklogId}`
        const worklogResponse = await fetch(worklogUrl, {
          method: 'PUT',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params!.accessToken}`,
          },
          body: JSON.stringify(buildWorklogBody(params!)),
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
          output: transformWorklogResponse(data, params!),
        }
      }

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
        output: transformWorklogResponse(data, params!),
      }
    },

    outputs: {
      ts: TIMESTAMP_OUTPUT,
      success: SUCCESS_OUTPUT,
      issueKey: { type: 'string', description: 'Issue key' },
      worklogId: { type: 'string', description: 'Updated worklog ID' },
      timeSpent: { type: 'string', description: 'Human-readable time spent (e.g., "3h 20m")' },
      timeSpentSeconds: { type: 'number', description: 'Time spent in seconds' },
      comment: { type: 'string', description: 'Worklog comment text' },
      author: {
        type: 'object',
        description: 'Worklog author',
        properties: USER_OUTPUT_PROPERTIES,
      },
      updateAuthor: {
        type: 'object',
        description: 'User who last updated the worklog',
        properties: USER_OUTPUT_PROPERTIES,
      },
      started: { type: 'string', description: 'Worklog start time in ISO format' },
      created: { type: 'string', description: 'Worklog creation time' },
      updated: { type: 'string', description: 'Worklog last update time' },
    },
  }
