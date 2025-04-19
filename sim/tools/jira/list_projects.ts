import { ToolConfig } from '../types'
import { JiraListProjectsParams, JiraListProjectsResponse } from './types'

export const jiraListProjectsTool: ToolConfig<JiraListProjectsParams, JiraListProjectsResponse> = {
  id: 'jira_list_projects',
  name: 'Jira List Projects',
  description: 'List projects from Jira using the Jira API.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
    additionalScopes: [
      'read:project:jira',
      'read:me',
      'offline_access',
    ],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'OAuth access token for Jira',
    },
    domain: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Maximum number of projects to return (default: 25, max: 100)',
    },
    title: {
      type: 'string',
      required: false,
      description: 'Filter projects by title',
    },
  },

  request: {
    url: (params: JiraListProjectsParams) => {
      const baseUrl = `https://${params.domain}/rest/api/2/project`
      const queryParams = new URLSearchParams()

      if (params.limit) {
        queryParams.append('limit', params.limit.toString())
      }

      if (params.title) {
        queryParams.append('title', params.title)
      }

      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'GET',
    headers: (params: JiraListProjectsParams) => {
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || 'Jira API error')
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        projects: data.results.map((project: any) => ({
          id: project.id,
          title: project.name,
          url: project._links?.webui || '',
          lastModified: project.version?.when || '',
        })),
      },
    }
  },

  transformError: (error: any) => {
    const message = error.message || 'Jira list projects failed'
    return message
  },
}
