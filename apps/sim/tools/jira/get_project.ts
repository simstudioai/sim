import type { JiraGetProjectParams, JiraGetProjectResponse } from '@/tools/jira/types'
import { PROJECT_DETAIL_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraGetProjectTool: ToolConfig<JiraGetProjectParams, JiraGetProjectResponse> = {
  id: 'jira_get_project',
  name: 'Jira Get Project',
  description: 'Get details of a specific Jira project',
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
    url: (params: JiraGetProjectParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/project/${encodeURIComponent(params.projectKeyOrId.trim())}?expand=lead,description`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetProjectParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetProjectParams) => {
    const fetchProject = async (cloudId: string) => {
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${encodeURIComponent(params!.projectKeyOrId.trim())}?expand=lead,description`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to get Jira project (${res.status})`
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
      data = await fetchProject(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get Jira project (${response.status})`
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
        id: data.id ?? '',
        key: data.key ?? '',
        name: data.name ?? '',
        description: data.description ?? null,
        projectTypeKey: data.projectTypeKey ?? null,
        style: data.style ?? null,
        simplified: data.simplified ?? null,
        self: data.self ?? '',
        url: data.url ?? null,
        lead: transformUser(data.lead),
        avatarUrl: data.avatarUrls?.['48x48'] ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    ...PROJECT_DETAIL_ITEM_PROPERTIES,
  },
}
