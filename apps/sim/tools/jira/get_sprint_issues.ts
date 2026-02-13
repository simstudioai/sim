import type { JiraGetSprintIssuesParams, JiraGetSprintIssuesResponse } from '@/tools/jira/types'
import { SEARCH_ISSUE_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { extractAdfText, getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

function transformSprintIssue(issue: any) {
  const fields = issue.fields ?? {}
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
    statusName: fields.status?.name ?? '',
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
    assigneeName: fields.assignee?.displayName ?? fields.assignee?.accountId ?? null,
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

export const jiraGetSprintIssuesTool: ToolConfig<
  JiraGetSprintIssuesParams,
  JiraGetSprintIssuesResponse
> = {
  id: 'jira_get_sprint_issues',
  name: 'Jira Get Sprint Issues',
  description: 'Get all issues in a specific sprint',
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
    sprintId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sprint ID to get issues from',
    },
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first issue to return (default: 0)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of issues to return (default: 50)',
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
    url: (params: JiraGetSprintIssuesParams) => {
      if (params.cloudId) {
        const startAt = params.startAt ?? 0
        const maxResults = params.maxResults ?? 50
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/agile/1.0/sprint/${params.sprintId}/issue?startAt=${startAt}&maxResults=${maxResults}`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetSprintIssuesParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetSprintIssuesParams) => {
    const fetchIssues = async (cloudId: string) => {
      const startAt = params?.startAt ?? 0
      const maxResults = params?.maxResults ?? 50
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0/sprint/${params!.sprintId}/issue?startAt=${startAt}&maxResults=${maxResults}`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to get sprint issues (${res.status})`
        try {
          const err = await res.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      return res.json()
    }

    let data: any
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      data = await fetchIssues(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get sprint issues (${response.status})`
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
        total: data.total ?? 0,
        startAt: data.startAt ?? 0,
        maxResults: data.maxResults ?? 0,
        issues: (data.issues ?? []).map(transformSprintIssue),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    total: { type: 'number', description: 'Total number of issues in the sprint' },
    startAt: { type: 'number', description: 'Pagination start index' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    issues: {
      type: 'array',
      description: 'Array of issues in the sprint',
      items: {
        type: 'object',
        properties: SEARCH_ISSUE_ITEM_PROPERTIES,
      },
    },
  },
}
