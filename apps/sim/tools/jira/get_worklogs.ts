import type { JiraGetWorklogsParams, JiraGetWorklogsResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT, WORKLOG_ITEM_PROPERTIES } from '@/tools/jira/types'
import { extractAdfText, getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Transforms a raw Jira worklog object into typed output.
 */
function transformWorklog(worklog: any) {
  return {
    id: worklog.id ?? '',
    author: transformUser(worklog.author) ?? { accountId: '', displayName: '' },
    authorName: worklog.author?.displayName ?? worklog.author?.accountId ?? 'Unknown',
    updateAuthor: transformUser(worklog.updateAuthor),
    comment: worklog.comment ? (extractAdfText(worklog.comment) ?? null) : null,
    started: worklog.started ?? '',
    timeSpent: worklog.timeSpent ?? '',
    timeSpentSeconds: worklog.timeSpentSeconds ?? 0,
    created: worklog.created ?? '',
    updated: worklog.updated ?? '',
  }
}

export const jiraGetWorklogsTool: ToolConfig<JiraGetWorklogsParams, JiraGetWorklogsResponse> = {
  id: 'jira_get_worklogs',
  name: 'Jira Get Worklogs',
  description: 'Get all worklog entries from a Jira issue',
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
      description: 'Jira issue key to get worklogs from (e.g., PROJ-123)',
    },
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first worklog to return (default: 0)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of worklogs to return (default: 50)',
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
    url: (params: JiraGetWorklogsParams) => {
      if (params.cloudId) {
        const startAt = params.startAt ?? 0
        const maxResults = params.maxResults ?? 50
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/worklog?startAt=${startAt}&maxResults=${maxResults}`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetWorklogsParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params?: JiraGetWorklogsParams) => {
    const fetchWorklogs = async (cloudId: string) => {
      const startAt = params?.startAt ?? 0
      const maxResults = params?.maxResults ?? 50
      const worklogsUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params!.issueKey}/worklog?startAt=${startAt}&maxResults=${maxResults}`
      const worklogsResponse = await fetch(worklogsUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })

      if (!worklogsResponse.ok) {
        let message = `Failed to get worklogs from Jira issue (${worklogsResponse.status})`
        try {
          const err = await worklogsResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return worklogsResponse.json()
    }

    let data: any

    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      data = await fetchWorklogs(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get worklogs from Jira issue (${response.status})`
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
      output: {
        ts: new Date().toISOString(),
        issueKey: params?.issueKey ?? 'unknown',
        total: data.total ?? 0,
        startAt: data.startAt ?? 0,
        maxResults: data.maxResults ?? 0,
        worklogs: (data.worklogs ?? []).map(transformWorklog),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    issueKey: { type: 'string', description: 'Issue key' },
    total: { type: 'number', description: 'Total number of worklogs' },
    startAt: { type: 'number', description: 'Pagination start index' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    worklogs: {
      type: 'array',
      description: 'Array of worklogs',
      items: {
        type: 'object',
        properties: WORKLOG_ITEM_PROPERTIES,
      },
    },
  },
}
