import type {
  JiraGetProjectComponentsParams,
  JiraGetProjectComponentsResponse,
} from '@/tools/jira/types'
import { COMPONENT_DETAIL_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraGetProjectComponentsTool: ToolConfig<
  JiraGetProjectComponentsParams,
  JiraGetProjectComponentsResponse
> = {
  id: 'jira_get_project_components',
  name: 'Jira Get Project Components',
  description: 'Get all components for a Jira project',
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
    url: (params: JiraGetProjectComponentsParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/project/${encodeURIComponent(params.projectKeyOrId.trim())}/components`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetProjectComponentsParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetProjectComponentsParams) => {
    const fetchComponents = async (cloudId: string) => {
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${encodeURIComponent(params!.projectKeyOrId.trim())}/components`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to get project components (${res.status})`
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
      data = await fetchComponents(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get project components (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    const components = Array.isArray(data) ? data : []
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        projectKeyOrId: params?.projectKeyOrId ?? 'unknown',
        total: components.length,
        components: components.map((c: any) => ({
          id: c.id ?? '',
          name: c.name ?? '',
          description: c.description ?? null,
          lead: transformUser(c.lead),
          assigneeType: c.assigneeType ?? null,
          project: c.project ?? null,
          projectId: c.projectId ?? null,
          self: c.self ?? '',
        })),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    projectKeyOrId: { type: 'string', description: 'Project key or ID' },
    total: { type: 'number', description: 'Total number of components' },
    components: {
      type: 'array',
      description: 'Array of project components',
      items: {
        type: 'object',
        properties: COMPONENT_DETAIL_ITEM_PROPERTIES,
      },
    },
  },
}
