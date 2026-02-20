import type {
  JiraGetProjectVersionsParams,
  JiraGetProjectVersionsResponse,
} from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT, VERSION_DETAIL_ITEM_PROPERTIES } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraGetProjectVersionsTool: ToolConfig<
  JiraGetProjectVersionsParams,
  JiraGetProjectVersionsResponse
> = {
  id: 'jira_get_project_versions',
  name: 'Jira Get Project Versions',
  description: 'Get all versions/releases for a Jira project',
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
    projectKeyOrId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project key (e.g., PROJ) or ID',
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
    url: (params: JiraGetProjectVersionsParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/project/${encodeURIComponent(params.projectKeyOrId.trim())}/versions`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetProjectVersionsParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetProjectVersionsParams) => {
    const fetchVersions = async (cloudId: string) => {
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${encodeURIComponent(params!.projectKeyOrId.trim())}/versions`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to get project versions (${res.status})`
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
      data = await fetchVersions(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get project versions (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    const versions = Array.isArray(data) ? data : []
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        projectKeyOrId: params?.projectKeyOrId ?? 'unknown',
        total: versions.length,
        versions: versions.map((v: any) => ({
          id: v.id ?? '',
          name: v.name ?? '',
          description: v.description ?? null,
          released: v.released ?? false,
          archived: v.archived ?? false,
          startDate: v.startDate ?? null,
          releaseDate: v.releaseDate ?? null,
          overdue: v.overdue ?? null,
          projectId: v.projectId ?? null,
          self: v.self ?? '',
        })),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    projectKeyOrId: { type: 'string', description: 'Project key or ID' },
    total: { type: 'number', description: 'Total number of versions' },
    versions: {
      type: 'array',
      description: 'Array of project versions',
      items: {
        type: 'object',
        properties: VERSION_DETAIL_ITEM_PROPERTIES,
      },
    },
  },
}
