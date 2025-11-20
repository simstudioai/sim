import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'
import type { JiraSearchIssuesParams, JiraSearchIssuesResponse } from './types'

export const jiraSearchIssuesTool: ToolConfig<JiraSearchIssuesParams, JiraSearchIssuesResponse> = {
  id: 'jira_search_issues',
  name: 'Jira Search Issues',
  description: 'Search for Jira issues using JQL (Jira Query Language)',
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
    jql: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JQL query string to search for issues (e.g., "project = PROJ AND status = Open")',
    },
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The index of the first result to return (for pagination)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (default: 50)',
    },
    fields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Array of field names to return (default: ['summary', 'status', 'assignee', 'created', 'updated'])",
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
    url: (params: JiraSearchIssuesParams) => {
      if (params.cloudId) {
        const query = new URLSearchParams()
        if (params.jql) query.set('jql', params.jql)
        if (typeof params.startAt === 'number') query.set('startAt', String(params.startAt))
        if (typeof params.maxResults === 'number')
          query.set('maxResults', String(params.maxResults))
        if (Array.isArray(params.fields) && params.fields.length > 0)
          query.set('fields', params.fields.join(','))
        const qs = query.toString()
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/search/jql${qs ? `?${qs}` : ''}`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: () => 'GET',
    headers: (params: JiraSearchIssuesParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: () => undefined as any,
  },

  transformResponse: async (response: Response, params?: JiraSearchIssuesParams) => {
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      const query = new URLSearchParams()
      if (params?.jql) query.set('jql', params.jql)
      if (typeof params?.startAt === 'number') query.set('startAt', String(params.startAt))
      if (typeof params?.maxResults === 'number') query.set('maxResults', String(params.maxResults))
      if (Array.isArray(params?.fields) && params.fields.length > 0)
        query.set('fields', params.fields.join(','))
      const searchUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql?${query.toString()}`
      const searchResponse = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
        body: JSON.stringify({
          jql: params?.jql,
          startAt: params?.startAt ? Number(params.startAt) : 0,
          maxResults: params?.maxResults ? Number(params.maxResults) : 50,
          fields: params?.fields || ['summary', 'status', 'assignee', 'created', 'updated'],
        }),
      })

      if (!searchResponse.ok) {
        let message = `Failed to search Jira issues (${searchResponse.status})`
        try {
          const err = await searchResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      const data = await searchResponse.json()

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          total: data?.total || 0,
          startAt: data?.startAt || 0,
          maxResults: data?.maxResults || 0,
          issues: (data?.issues || []).map((issue: any) => ({
            key: issue.key,
            summary: issue.fields?.summary,
            status: issue.fields?.status?.name,
            assignee: issue.fields?.assignee?.displayName || issue.fields?.assignee?.accountId,
            created: issue.fields?.created,
            updated: issue.fields?.updated,
          })),
        },
      }
    }

    if (!response.ok) {
      let message = `Failed to search Jira issues (${response.status})`
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
        total: data?.total || 0,
        startAt: data?.startAt || 0,
        maxResults: data?.maxResults || 0,
        issues: (data?.issues || []).map((issue: any) => ({
          key: issue.key,
          summary: issue.fields?.summary,
          status: issue.fields?.status?.name,
          assignee: issue.fields?.assignee?.displayName || issue.fields?.assignee?.accountId,
          created: issue.fields?.created,
          updated: issue.fields?.updated,
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
      description:
        'Search results with timestamp, total count, pagination details, and array of matching issues',
    },
  },
}
