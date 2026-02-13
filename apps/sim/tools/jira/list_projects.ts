import type { JiraListProjectsParams, JiraListProjectsResponse } from '@/tools/jira/types'
import { PROJECT_DETAIL_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraListProjectsTool: ToolConfig<JiraListProjectsParams, JiraListProjectsResponse> = {
  id: 'jira_list_projects',
  name: 'Jira List Projects',
  description: 'List or search projects in Jira',
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
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query to filter projects by name',
    },
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first project to return (default: 0)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of projects to return (default: 50)',
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
    url: (params: JiraListProjectsParams) => {
      if (params.cloudId) {
        const startAt = params.startAt ?? 0
        const maxResults = params.maxResults ?? 50
        let url = `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/project/search?startAt=${startAt}&maxResults=${maxResults}&expand=lead`
        if (params.query) {
          url += `&query=${encodeURIComponent(params.query)}`
        }
        return url
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraListProjectsParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraListProjectsParams) => {
    const fetchProjects = async (cloudId: string) => {
      const startAt = params?.startAt ?? 0
      const maxResults = params?.maxResults ?? 50
      let url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search?startAt=${startAt}&maxResults=${maxResults}&expand=lead`
      if (params?.query) {
        url += `&query=${encodeURIComponent(params.query)}`
      }
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to list Jira projects (${res.status})`
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
      data = await fetchProjects(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to list Jira projects (${response.status})`
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
        isLast: data.isLast ?? true,
        projects: (data.values ?? []).map((p: any) => ({
          id: p.id ?? '',
          key: p.key ?? '',
          name: p.name ?? '',
          description: p.description ?? null,
          projectTypeKey: p.projectTypeKey ?? null,
          style: p.style ?? null,
          simplified: p.simplified ?? null,
          self: p.self ?? '',
          url: p.url ?? null,
          lead: transformUser(p.lead),
          avatarUrl: p.avatarUrls?.['48x48'] ?? null,
        })),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    total: { type: 'number', description: 'Total number of projects' },
    startAt: { type: 'number', description: 'Pagination start index' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    isLast: { type: 'boolean', description: 'Whether this is the last page' },
    projects: {
      type: 'array',
      description: 'Array of projects',
      items: {
        type: 'object',
        properties: PROJECT_DETAIL_ITEM_PROPERTIES,
      },
    },
  },
}
