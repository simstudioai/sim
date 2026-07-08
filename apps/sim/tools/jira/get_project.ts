import type { JiraGetProjectParams, JiraGetProjectResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

function buildProjectUrl(cloudId: string, projectIdOrKey: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${encodeURIComponent(projectIdOrKey)}`
}

export const jiraGetProjectTool: ToolConfig<JiraGetProjectParams, JiraGetProjectResponse> = {
  id: 'jira_get_project',
  name: 'Jira Get Project',
  description:
    'Get the details of a single Jira project by its ID or key, including its type, lead, components, issue types, and versions.',
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
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The project ID or key (e.g., "PROJ" or "10000")',
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
        return buildProjectUrl(params.cloudId, params.projectId)
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
      const projectResponse = await fetch(buildProjectUrl(cloudId, params!.projectId), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })

      if (!projectResponse.ok) {
        const errorText = await projectResponse.text()
        throw new Error(
          parseAtlassianErrorMessage(projectResponse.status, projectResponse.statusText, errorText)
        )
      }

      return projectResponse.json()
    }

    let data: any

    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      data = await fetchProject(cloudId)
    } else {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(parseAtlassianErrorMessage(response.status, response.statusText, errorText))
      }
      data = await response.json()
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        id: data?.id ?? '',
        key: data?.key ?? '',
        name: data?.name ?? '',
        description: data?.description ?? null,
        projectTypeKey: data?.projectTypeKey ?? null,
        simplified: data?.simplified ?? null,
        style: data?.style ?? null,
        isPrivate: data?.isPrivate ?? null,
        url: data?.self ?? null,
        leadDisplayName: data?.lead?.displayName ?? null,
        leadAccountId: data?.lead?.accountId ?? null,
        issueTypes: Array.isArray(data?.issueTypes)
          ? data.issueTypes.map((t: any) => ({
              id: t?.id ?? '',
              name: t?.name ?? '',
              subtask: t?.subtask ?? null,
            }))
          : [],
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    id: { type: 'string', description: 'Project ID' },
    key: { type: 'string', description: 'Project key (e.g., PROJ)' },
    name: { type: 'string', description: 'Project name' },
    description: { type: 'string', description: 'Project description', optional: true },
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
    isPrivate: { type: 'boolean', description: 'Whether the project is private', optional: true },
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
    issueTypes: {
      type: 'array',
      description: 'Issue types available in this project',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Issue type ID' },
          name: { type: 'string', description: 'Issue type name (e.g., Task, Bug, Story)' },
          subtask: {
            type: 'boolean',
            description: 'Whether this issue type is a subtask',
            optional: true,
          },
        },
      },
    },
  },
}
