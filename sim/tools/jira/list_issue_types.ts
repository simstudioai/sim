import { ToolConfig } from '../types'
import { JiraListIssueTypesParams, JiraListIssueTypesResponse } from './types'

export const jiraListIssueTypesTool: ToolConfig<JiraListIssueTypesParams, JiraListIssueTypesResponse> = {
  id: 'jira_list_issue_types',
  name: 'Jira List Issue Types',
  description: 'List issue types from Jira using the Jira API.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
    additionalScopes: [
        'read:issue-type:jira',
        'read:field:jira',
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
    projectId: {
      type: 'string',
      required: true,
      description: 'The ID of the project to list issue types for',
    },
  },

  request: {
    url: (params: JiraListIssueTypesParams) => {
      const baseUrl = `http://${params.domain}/rest/api/3/issue/createmeta/${params.projectId}/issuetypes`
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
    headers: (params: JiraListIssueTypesParams) => {
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
        issueTypes: data.results.map((issueType: any) => ({
          id: issueType.id,
          title: issueType.name,
          url: issueType._links?.webui || '',
          lastModified: issueType.version?.when || '',
        })),
      },
    }
  },

  transformError: (error: any) => {
    const message = error.message || 'Jira list issue types failed'
    return message
  },
}