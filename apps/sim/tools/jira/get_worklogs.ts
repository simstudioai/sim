import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface JiraGetWorklogsParams {
  accessToken: string
  domain: string
  issueKey: string
  startAt?: number
  maxResults?: number
  cloudId?: string
}

export interface JiraGetWorklogsResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    total: number
    worklogs: Array<{
      id: string
      author: string
      timeSpentSeconds: number
      timeSpent: string
      comment?: string
      created: string
      updated: string
      started: string
    }>
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
        const startAt = params.startAt || 0
        const maxResults = params.maxResults || 50
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
    // Extract text from Atlassian Document Format
    const extractText = (content: any): string => {
      if (!content) return ''
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        return content.map(extractText).join(' ')
      }
      if (content.type === 'text') return content.text || ''
      if (content.content) return extractText(content.content)
      return ''
    }

    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      // Make the actual request with the resolved cloudId
      const startAt = params?.startAt || 0
      const maxResults = params?.maxResults || 50
      const worklogsUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params?.issueKey}/worklog?startAt=${startAt}&maxResults=${maxResults}`
      const worklogsResponse = await fetch(worklogsUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params?.accessToken}`,
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

      const data = await worklogsResponse.json()

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: params?.issueKey || 'unknown',
          total: data.total || 0,
          worklogs: (data.worklogs || []).map((worklog: any) => ({
            id: worklog.id,
            author: worklog.author?.displayName || worklog.author?.accountId || 'Unknown',
            timeSpentSeconds: worklog.timeSpentSeconds,
            timeSpent: worklog.timeSpent,
            comment: worklog.comment ? extractText(worklog.comment) : undefined,
            created: worklog.created,
            updated: worklog.updated,
            started: worklog.started,
          })),
        },
      }
    }

    // If cloudId was provided, process the response
    if (!response.ok) {
      let message = `Failed to get worklogs from Jira issue (${response.status})`
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
        total: data.total || 0,
        worklogs: (data.worklogs || []).map((worklog: any) => ({
          id: worklog.id,
          author: worklog.author?.displayName || worklog.author?.accountId || 'Unknown',
          timeSpentSeconds: worklog.timeSpentSeconds,
          timeSpent: worklog.timeSpent,
          comment: worklog.comment ? extractText(worklog.comment) : undefined,
          created: worklog.created,
          updated: worklog.updated,
          started: worklog.started,
        })),
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
      description: 'Worklogs data with timestamp, issue key, total count, and array of worklogs',
    },
  },
}
