import type { JiraUpdateParams, JiraUpdateResponse } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraUpdateTool: ToolConfig<JiraUpdateParams, JiraUpdateResponse> = {
  id: 'jira_update',
  name: 'Jira Update',
  description: 'Update a Jira issue',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
    additionalScopes: ['read:jira-user', 'write:jira-work', 'write:issue:jira', 'read:jira-work'],
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
      required: false,
      visibility: 'user-only',
      description:
        'Jira project ID to update issues in. If not provided, all issues will be retrieved.',
    },
    issueKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jira issue key to update',
    },
    summary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New summary for the issue',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the issue',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New status for the issue',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New priority for the issue',
    },
    assignee: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New assignee for the issue',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },
  outputs: {
    success: {
      type: 'boolean',
      description: 'Operation success status',
    },
    output: {
      type: 'object',
      description:
        'Updated Jira issue details with timestamp, issue key, summary, and success status',
    },
  },

  directExecution: async (params) => {
    // Pre-fetch the cloudId if not provided
    if (!params.cloudId) {
      params.cloudId = await getJiraCloudId(params.domain, params.accessToken)
    }
    return undefined // Let the regular request handling take over
  },

  request: {
    url: (params) => {
      const { domain, issueKey, cloudId } = params
      if (!domain || !issueKey || !cloudId) {
        throw new Error('Domain, issueKey, and cloudId are required')
      }

      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}`
      return url
    },
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      // Map the summary from either summary or title field
      const summaryValue = params.summary || params.title
      const descriptionValue = params.description

      const fields: Record<string, any> = {}

      if (summaryValue) {
        fields.summary = summaryValue
      }

      if (descriptionValue) {
        fields.description = {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: descriptionValue,
                },
              ],
            },
          ],
        }
      }

      if (params.status) {
        fields.status = {
          name: params.status,
        }
      }

      if (params.priority) {
        fields.priority = {
          name: params.priority,
        }
      }

      if (params.assignee) {
        fields.assignee = {
          id: params.assignee,
        }
      }

      return { fields }
    },
  },

  transformResponse: async (response: Response, params?: JiraUpdateParams) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: params?.issueKey || 'unknown',
          summary: 'Issue updated successfully',
          success: true,
        },
      }
    }

    const data = JSON.parse(responseText)
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: data.key || params?.issueKey || 'unknown',
        summary: data.fields?.summary || 'Issue updated',
        success: true,
      },
    }
  },

  transformError: (error: Error) => {
    return `Jira API Error: ${error.message}`
  },
}
