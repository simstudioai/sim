import type { JiraSearchIssuesParams, JiraSearchIssuesResponse } from '@/tools/jira/types'
import { SEARCH_ISSUE_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import {
  extractAdfText,
  getJiraCloudId,
  transformIssueData,
  transformUser,
} from '@/tools/jira/utils'
import type { ToolConfig, ToolResponseContext } from '@/tools/types'

/** The caller's explicit `fields` list, or null when the search falls back to `*all`. */
function explicitFields(params: JiraSearchIssuesParams | undefined): string[] | null {
  return Array.isArray(params?.fields) && params.fields.length > 0 ? params.fields : null
}

function expandsRenderedFields(expand: string | undefined): boolean {
  return (expand ?? '').split(',').some((expansion) => expansion.trim() === 'renderedFields')
}

/**
 * Transforms a raw Jira search result issue into typed output. The heavy fields
 * (`descriptionAdf`, `customFields`, `attachments`, `issuelinks`, `subtasks`) are only
 * included when the caller asked for specific `fields`, since the default `*all` search
 * would otherwise attach every custom field to every item.
 */
function transformSearchIssue(issue: any, params: JiraSearchIssuesParams | undefined) {
  const fields = issue?.fields ?? {}
  const full = transformIssueData(issue)
  const heavyFields = explicitFields(params)
    ? {
        descriptionAdf: full.descriptionAdf,
        issuelinks: full.issuelinks,
        subtasks: full.subtasks,
        attachments: full.attachments,
        customFields: full.customFields,
      }
    : {}
  return {
    ...heavyFields,
    ...(expandsRenderedFields(params?.expand)
      ? { renderedDescription: full.renderedDescription }
      : {}),
    environment: full.environment,
    creator: full.creator,
    fixVersions: full.fixVersions,
    resolutiondate: full.resolutiondate,
    timetracking: full.timetracking,
    parent: full.parent,
    votes: full.votes,
    watches: full.watches,
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
    statusName: fields.status?.name ?? '',
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
      visibility: 'user-or-llm',
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
        'Array of field names to return (default: all fields). When set, each issue also includes descriptionAdf, customFields, attachments, issuelinks, and subtasks.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated expansions: renderedFields, names, schema, transitions, operations, editmeta, changelog',
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
        query.set('fields', explicitFields(params)?.join(',') ?? '*all')
        if (params.expand) query.set('expand', params.expand)
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

  transformResponse: async (
    response: Response,
    params?: JiraSearchIssuesParams,
    context?: ToolResponseContext
  ) => {
    const performSearch = async (cloudId: string) => {
      const query = new URLSearchParams()
      if (params?.jql) query.set('jql', params.jql)
      if (params?.nextPageToken) query.set('nextPageToken', params.nextPageToken)
      if (typeof params?.maxResults === 'number') query.set('maxResults', String(params.maxResults))
      query.set('fields', explicitFields(params)?.join(',') ?? '*all')
      if (params?.expand) query.set('expand', params.expand)
      const searchUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql?${query.toString()}`
      const searchResponse = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
        signal: context?.signal,
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
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken, {
        signal: context?.signal,
      })
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
        issues: (data?.issues ?? []).map((issue: unknown) => transformSearchIssue(issue, params)),
        nextPageToken: data?.nextPageToken ?? null,
        isLast: data?.isLast ?? !data?.nextPageToken,
        total: null,
        names: data?.names ?? null,
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
    names: {
      type: 'json',
      description:
        'Map of field ID to display name (e.g., customfield_10020 → "Sprint"). Only returned when expand includes names.',
      optional: true,
    },
    total: {
      type: 'number',
      description:
        'Always null. The Jira /search/jql endpoint does not return a total count; use isLast and nextPageToken for pagination.',
      optional: true,
    },
  },
}
