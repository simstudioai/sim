import type { JiraGetChangelogParams, JiraGetChangelogResponse } from '@/tools/jira/types'
import { CHANGELOG_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraGetChangelogTool: ToolConfig<JiraGetChangelogParams, JiraGetChangelogResponse> = {
  id: 'jira_get_changelog',
  name: 'Jira Get Changelog',
  description: 'Get the changelog (history of changes) for a Jira issue',
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
      description: 'Jira issue key to get changelog for (e.g., PROJ-123)',
    },
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first changelog entry to return (default: 0)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of changelog entries to return (default: 100)',
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
    url: (params: JiraGetChangelogParams) => {
      if (params.cloudId) {
        const startAt = params.startAt ?? 0
        const maxResults = params.maxResults ?? 100
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/changelog?startAt=${startAt}&maxResults=${maxResults}`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetChangelogParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetChangelogParams) => {
    const fetchChangelog = async (cloudId: string) => {
      const startAt = params?.startAt ?? 0
      const maxResults = params?.maxResults ?? 100
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params!.issueKey}/changelog?startAt=${startAt}&maxResults=${maxResults}`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to get changelog (${res.status})`
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
      data = await fetchChangelog(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get changelog (${response.status})`
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
        changelog: (data.values ?? []).map((entry: any) => ({
          id: entry.id ?? '',
          author: transformUser(entry.author),
          created: entry.created ?? '',
          items: (entry.items ?? []).map((item: any) => ({
            field: item.field ?? '',
            fieldtype: item.fieldtype ?? '',
            from: item.from ?? null,
            fromString: item.fromString ?? null,
            to: item.to ?? null,
            toString: item.toString ?? null,
          })),
        })),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    issueKey: { type: 'string', description: 'Issue key' },
    total: { type: 'number', description: 'Total number of changelog entries' },
    startAt: { type: 'number', description: 'Pagination start index' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    changelog: {
      type: 'array',
      description: 'Array of changelog entries',
      items: {
        type: 'object',
        properties: CHANGELOG_ITEM_PROPERTIES,
      },
    },
  },
}
