import { ToolConfig } from '../types'
import { JiraWriteResponse } from './types'
import { JiraWriteParams } from './types'

export const jiraWriteTool: ToolConfig<JiraWriteParams, JiraWriteResponse> = {
    id: 'jira_write',
    name: 'Jira Write',
    description: 'Write a Jira issue',
    version: '1.0.0',

    oauth: {
        required: true,
        provider: 'jira',
        additionalScopes: [
            'read:jira-user',
            'write:jira-work',
            'read:project:jira',
            'read:issue-type:jira',
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
          summary: {
            type: 'string',
            required: false,
            description: 'Summary for the issue',
          },

          description: {
            type: 'string',
            required: false,
            description: 'Description for the issue',
          },
          status: {
            type: 'string',
            required: false,
            description: 'Status for the issue',
          },
          priority: {
            type: 'string',
            required: false,
            description: 'Priority for the issue',
          },
          assignee: {
            type: 'string',
            required: false,
            description: 'Assignee for the issue',
          },
          projectId: {
            type: 'string',
            required: true,
            description: 'Project ID for the issue',
          },
          issueTypeId: {
            type: 'string',
            required: true,
            description: 'Issue Type ID for the issue',
          },
    },

    request: {
        url: (params: JiraWriteParams) => {
          return `https://${params.domain}/rest/api/3/issue`
        },
        method: 'POST',
        headers: (params: JiraWriteParams) => {
          return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params.accessToken}`,
          }
        },
        body: (params: JiraWriteParams) => {
            const body: Record<string, any> = {
                fields: {
                    project: {
                        id: params.projectId
                    },
                    issuetype: {
                        id: params.issueTypeId
                    },
                    summary: params.summary
                }
            }

            if (params.description) {
                body.fields.description = {
                    type: 'doc',
                    version: 1,
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: params.description
                                }
                            ]
                        }
                    ]
                }
            }

            if (params.assignee) {
                body.fields.assignee = {
                    id: params.assignee
                }
            }

            if (params.priority) {
                body.fields.priority = {
                    name: params.priority
                }
            }

            return body
        },
    },

    transformResponse: async (response: Response) => {
        const data = await response.json()
        if (!response.ok) {
            throw new Error(data.message || 'Failed to create Jira issue')
        }

        return {
            success: true,
            output: {
                ts: new Date().toISOString(),
                issueKey: data.key,
                summary: data.fields?.summary || '',
                success: true,
                url: `https://${data.domain}/browse/${data.issueKey}` //TODO: review this
            },
        }
    },

    transformError: (error: any) => {
        const message = error.message || 'Failed to create Jira issue'
        return message
    },
}