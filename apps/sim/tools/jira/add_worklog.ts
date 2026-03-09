import type { JiraAddWorklogParams, JiraAddWorklogResponse } from '@/tools/jira/types'
import { SUCCESS_OUTPUT, TIMESTAMP_OUTPUT, USER_OUTPUT_PROPERTIES } from '@/tools/jira/types'
import { getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Builds the worklog request body per Jira API v3.
 */
function buildWorklogBody(params: JiraAddWorklogParams) {
  const body: Record<string, any> = {
    timeSpentSeconds: Number(params.timeSpentSeconds),
    comment: params.comment
      ? {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: params.comment }],
            },
          ],
        }
      : undefined,
    started:
      (params.started ? params.started.replace(/Z$/, '+0000') : undefined) ||
      new Date().toISOString().replace(/Z$/, '+0000'),
  }
  if (params.visibility) body.visibility = params.visibility
  return body
}

/**
 * Transforms a worklog API response into typed output.
 */
function transformWorklogResponse(data: any, params: JiraAddWorklogParams) {
  return {
    ts: new Date().toISOString(),
    issueKey: params.issueKey ?? 'unknown',
    worklogId: data?.id ?? 'unknown',
    timeSpent: data?.timeSpent ?? '',
    timeSpentSeconds: data?.timeSpentSeconds ?? Number(params.timeSpentSeconds) ?? 0,
    author: transformUser(data?.author) ?? { accountId: '', displayName: '' },
    started: data?.started ?? '',
    created: data?.created ?? '',
    success: true,
  }
}

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
      return buildWorklogBody(params)
    },
  },

  transformResponse: async (response: Response, params?: JiraAddWorklogParams) => {
    if (!params?.timeSpentSeconds || params.timeSpentSeconds <= 0) {
      throw new Error('timeSpentSeconds is required and must be greater than 0')
    }

    const makeRequest = async (cloudId: string) => {
      const worklogUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params!.issueKey}/worklog`
      const worklogResponse = await fetch(worklogUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
        body: JSON.stringify(buildWorklogBody(params!)),
      })

      if (!worklogResponse.ok) {
        let message = `Failed to add worklog to Jira issue (${worklogResponse.status})`
        try {
          const err = await worklogResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return worklogResponse.json()
    }

    let data: any

    if (!params.cloudId) {
      const cloudId = await getJiraCloudId(params.domain, params.accessToken)
      data = await makeRequest(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to add worklog to Jira issue (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    return {
      success: true,
      output: transformWorklogResponse(data, params),
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    success: SUCCESS_OUTPUT,
    issueKey: { type: 'string', description: 'Issue key the worklog was added to' },
    worklogId: { type: 'string', description: 'Created worklog ID' },
    timeSpent: {
      type: 'string',
      description: 'Time spent in human-readable format (e.g., 3h 20m)',
    },
    timeSpentSeconds: { type: 'number', description: 'Time spent in seconds' },
    author: {
      type: 'object',
      description: 'Worklog author',
      properties: USER_OUTPUT_PROPERTIES,
    },
    started: { type: 'string', description: 'ISO 8601 timestamp when the work started' },
    created: { type: 'string', description: 'ISO 8601 timestamp when the worklog was created' },
  },
}
