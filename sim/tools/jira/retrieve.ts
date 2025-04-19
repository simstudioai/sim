import { ToolConfig } from '../types'
import { JiraRetrieveResponse } from './types'
import { JiraRetrieveParams } from './types'

export const jiraRetrieveTool: ToolConfig<JiraRetrieveParams, JiraRetrieveResponse> = {
    id: 'jira_retrieve',
    name: 'Jira Retrieve',
    description: 'Retrieve a Jira issue',
    version: '1.0.0',

    oauth: {
        required: true,
        provider: 'jira',
        additionalScopes: [
            'read:jira-work',
            'read:jira-user',
            'read:me',
            'offline_access',
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
        issueKey: {
          type: 'string',
          required: true,
          description: 'Jira issue key to retrieve',
        },
    },
    
      request: {
        url: (params: JiraRetrieveParams) => {
          return `https://${params.domain}/rest/api/2/events/` //TODO: possibly change the endpoint
        },
        method: 'PUT',
        headers: (params: JiraRetrieveParams) => {
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
            issueKey: data.key,
            summary: data.fields.summary,
            description: data.fields.description,
            created: data.fields.created,
            updated: data.fields.updated,
            success: true,
          },
        }
      },
    
      transformError: (error: any) => {
        const message = error.message || 'Jira update failed'
        return message
      },
    }
    