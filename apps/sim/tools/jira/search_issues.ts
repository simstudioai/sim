import type { JiraSearchIssuesParams, JiraSearchIssuesResponse } from '@/tools/jira/types'
import { SEARCH_ISSUE_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { extractAdfText, getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Transforms a raw Jira search result issue into typed output.
 */
function transformSearchIssue(issue: any) {
  const fields = issue?.fields ?? {}
  return {
    id: issue.id ?? '',
    key: issue.key ?? '',
    self: issue.self ?? '',
    summary: fields.summary ?? '',
    description: extractAdfText(fields.description),
    status: {
      id: fields.status?.id ?? '',
      name: fields.status?.name ?? '',
      description: fields.status?.description ?? null,
      statusCategory: fields.status?.statusCategory
        ? {
            id: fields.status.statusCategory.id,
            key: fields.status.statusCategory.key ?? '',
            name: fields.status.statusCategory.name ?? '',
            colorName: fields.status.statusCategory.colorName ?? '',
          }
        : null,
    },
    issuetype: {
      id: fields.issuetype?.id ?? '',
      name: fields.issuetype?.name ?? '',
      description: fields.issuetype?.description ?? null,
      subtask: fields.issuetype?.subtask ?? false,
      iconUrl: fields.issuetype?.iconUrl ?? null,
    },
    project: {
      id: fields.project?.id ?? '',
      key: fields.project?.key ?? '',
      name: fields.project?.name ?? '',
      projectTypeKey: fields.project?.projectTypeKey ?? null,
    },
    priority: fields.priority
      ? {
          id: fields.priority.id ?? '',
          name: fields.priority.name ?? '',
          iconUrl: fields.priority.iconUrl ?? null,
        }
      : null,
    assignee: transformUser(fields.assignee),
    reporter: transformUser(fields.reporter),
    labels: fields.labels ?? [],
    components: (fields.components ?? []).map((c: any) => ({
      id: c.id ?? '',
      name: c.name ?? '',
      description: c.description ?? null,
    })),
    resolution: fields.resolution
      ? {
          id: fields.resolution.id ?? '',
          name: fields.resolution.name ?? '',
          description: fields.resolution.description ?? null,
        }
      : null,
    duedate: fields.duedate ?? null,
    created: fields.created ?? '',
    updated: fields.updated ?? '',
  }
}

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
    nextPageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor token for the next page of results. Omit for the first page.',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return per page (default: 50)',
    },
    fields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of field names to return (default: all navigable). Use "*all" for every field.',
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
        if (params.nextPageToken) query.set('nextPageToken', params.nextPageToken)
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
    headers: (params: JiraSearchIssuesParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: () => undefined as any,
  },

  transformResponse: async (response: Response, params?: JiraSearchIssuesParams) => {
    const performSearch = async (cloudId: string) => {
      const query = new URLSearchParams()
      if (params?.jql) query.set('jql', params.jql)
      if (params?.nextPageToken) query.set('nextPageToken', params.nextPageToken)
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
      })

      if (!searchResponse.ok) {
        let message = `Failed to search Jira issues (${searchResponse.status})`
        try {
          const err = await searchResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return searchResponse.json()
    }

    let data: any

    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      data = await performSearch(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to search Jira issues (${response.status})`
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
        issues: (data?.issues ?? []).map(transformSearchIssue),
        nextPageToken: data?.nextPageToken ?? null,
        isLast: data?.isLast ?? true,
        total: data?.total ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    issues: {
      type: 'array',
      description: 'Array of matching issues',
      items: {
        type: 'object',
        properties: SEARCH_ISSUE_ITEM_PROPERTIES,
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Cursor token for the next page. Null when no more results.',
      optional: true,
    },
    isLast: { type: 'boolean', description: 'Whether this is the last page of results' },
    total: {
      type: 'number',
      description: 'Total number of matching issues (may not always be available)',
      optional: true,
    },
  },
}
