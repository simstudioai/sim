import { ToolConfig } from '../types'
import { JiraUpdateResponse } from './types'
import { JiraUpdateParams } from './types'

export const jiraUpdateTool: ToolConfig<JiraUpdateParams, JiraUpdateResponse> = {
    id: 'jira_update',
    name: 'Jira Update',
    description: 'Update a Jira issue',
    version: '1.0.0',

    oauth: {
        required: true,
        provider: 'jira',
        additionalScopes: [
            'read:jira-user',
            'write:jira-work',
          ],
    },

    //TODO: modify params to match the Jira API

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
        projectId: {
          type: 'string',
          required: false,
          description: 'Jira project ID to update issues in. If not provided, all issues will be retrieved.',
        },
        issueKey: {
          type: 'string',
          required: true,
          description: 'Jira issue key to update',
        },
        summary: {
          type: 'string',
          required: false,
          description: 'New summary for the issue',
        },
        description: {
          type: 'string',
          required: false,
          description: 'New description for the issue',
        },
        status: {
          type: 'string',
          required: false,
          description: 'New status for the issue',
        },
        priority: {
          type: 'string',
          required: false,
          description: 'New priority for the issue',
        },
        assignee: {
          type: 'string',
          required: false,
          description: 'New assignee for the issue',
        },
        cloudId: {
          type: 'string',
          required: false,
          description: 'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
        },
    },
    
      request: {
        url: (params: JiraUpdateParams) => {
          if (params.cloudId) {
            return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}?expand=renderedFields,names,schema,transitions,operations,editmeta,changelog`;
          }
          return `https://${params.domain}/rest/api/3/issue/${params.issueKey}`
        },
        method: 'PUT',
        headers: (params: JiraUpdateParams) => {
          return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params.accessToken}`,
          }
        },
        body: (params: JiraUpdateParams) => {
          const body: Record<string, any> = {}
    
          if (params.summary) {
            body.summary = params.summary
          }
    
          if (params.description) {
            body.body = {
              representation: 'storage',
              value: params.description,
            }
          }
    
          if (params.assignee) {
            body.version = {
              number: params.assignee,
              message: 'Updated via Sim Studio',
            }
          } 

          if (params.status) {
            body.status = {
              name: params.status,
            }
          }

          if (params.priority) {
            body.priority = {
              name: params.priority,
            }
          }
          
    
          return body
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
            boardId: data.boardId,
            issueKey: data.key,
            summary: data.fields.summary,
            success: true,
          },
        }
      },
    
      transformError: (error: any) => {
        const message = error.message || 'Jira update failed'
        return message
      },
    }