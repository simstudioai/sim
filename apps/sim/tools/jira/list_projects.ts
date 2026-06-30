import type { JiraListProjectsParams, JiraListProjectsResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Transforms a raw Jira project object into typed output.
 */
function transformProject(project: any) {
  return {
    id: project.id ?? '',
    key: project.key ?? '',
    name: project.name ?? '',
    projectTypeKey: project.projectTypeKey ?? null,
    simplified: project.simplified ?? null,
    style: project.style ?? null,
    isPrivate: project.isPrivate ?? null,
    url: project.self ?? null,
    leadDisplayName: project.lead?.displayName ?? null,
    leadAccountId: project.lead?.accountId ?? null,
  }
}

function buildSearchUrl(cloudId: string, params: JiraListProjectsParams): string {
  const queryParams = new URLSearchParams()
  if (params.query) queryParams.append('query', params.query)
  if (params.startAt !== undefined) queryParams.append('startAt', String(params.startAt))
  if (params.maxResults !== undefined) queryParams.append('maxResults', String(params.maxResults))
  const queryString = queryParams.toString()
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search${queryString ? `?${queryString}` : ''}`
}

export const jiraListProjectsTool: ToolConfig<JiraListProjectsParams, JiraListProjectsResponse> = {
  id: 'jira_list_projects',
  name: 'Jira List Projects',
  description:
    'List Jira projects visible to the user, with optional name/key filtering and pagination. Returns each project with id, key, name, and type.',
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
      description: 'Filter projects by partial name or key match',
    },
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The index of the first project to return (for pagination, default: 0)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of projects to return (default: 50, max: 100)',
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
        return buildSearchUrl(params.cloudId, params)
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
      const projectsResponse = await fetch(buildSearchUrl(cloudId, params!), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })

      if (!projectsResponse.ok) {
        const errorText = await projectsResponse.text()
        throw new Error(
          parseAtlassianErrorMessage(
            projectsResponse.status,
            projectsResponse.statusText,
            errorText
          )
        )
      }

      return projectsResponse.json()
    }

    let data: any

    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      data = await fetchProjects(cloudId)
    } else {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(parseAtlassianErrorMessage(response.status, response.statusText, errorText))
      }
      data = await response.json()
    }

    const values = Array.isArray(data?.values) ? data.values : []

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        projects: values.map(transformProject),
        total: typeof data?.total === 'number' ? data.total : values.length,
        startAt: typeof data?.startAt === 'number' ? data.startAt : (params?.startAt ?? 0),
        maxResults:
          typeof data?.maxResults === 'number' ? data.maxResults : (params?.maxResults ?? 50),
        isLast: data?.isLast ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    projects: {
      type: 'array',
      description: 'Array of Jira projects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Project ID' },
          key: { type: 'string', description: 'Project key (e.g., PROJ)' },
          name: { type: 'string', description: 'Project name' },
          projectTypeKey: {
            type: 'string',
            description: 'Project type key (e.g., software, service_desk, business)',
            optional: true,
          },
          simplified: {
            type: 'boolean',
            description: 'Whether the project is a simplified (team-managed) project',
            optional: true,
          },
          style: {
            type: 'string',
            description: 'Project style (e.g., classic, next-gen)',
            optional: true,
          },
          isPrivate: {
            type: 'boolean',
            description: 'Whether the project is private',
            optional: true,
          },
          url: { type: 'string', description: 'REST API URL for this project', optional: true },
          leadDisplayName: {
            type: 'string',
            description: 'Display name of the project lead',
            optional: true,
          },
          leadAccountId: {
            type: 'string',
            description: 'Account ID of the project lead',
            optional: true,
          },
        },
      },
    },
    total: { type: 'number', description: 'Total number of matching projects' },
    startAt: { type: 'number', description: 'Pagination start index' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    isLast: {
      type: 'boolean',
      description: 'Whether this is the last page of results',
      optional: true,
    },
  },
}
