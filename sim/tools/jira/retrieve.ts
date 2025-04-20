import { ToolConfig } from '../types'
import { JiraRetrieveResponse } from './types'
import { JiraRetrieveParams } from './types'

export const jiraRetrieveTool: ToolConfig<JiraRetrieveParams, JiraRetrieveResponse> = {
    id: 'jira_retrieve',
    name: 'Jira Retrieve',
    description: 'Retrieve detailed information about a specific Jira issue',
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
            description: 'Jira issue key to retrieve (e.g., PROJ-123)',
        },
    },
    
    request: {
        url: (params: JiraRetrieveParams) => {
            return `https://${params.domain}/rest/api/3/issue/${params.issueKey}?expand=renderedFields,names,schema,transitions,operations,editmeta,changelog`
        },
        method: 'GET',
        headers: (params: JiraRetrieveParams) => {
            return {
                'Accept': 'application/json',
                'Authorization': `Bearer ${params.accessToken}`,
            }
        },
    },
    
    transformResponse: async (response: Response) => {
        const data = await response.json()
        if (!response.ok) {
            throw new Error(data.message || 'Failed to retrieve Jira issue')
        }

        return {
            success: true,
            output: {
                ts: new Date().toISOString(),
                issueKey: data.key,
                summary: data.fields.summary,
                description: data.fields.description,
                status: data.fields.status?.name,
                priority: data.fields.priority?.name,
                assignee: data.fields.assignee?.displayName,
                reporter: data.fields.reporter?.displayName,
                created: data.fields.created,
                updated: data.fields.updated,
                labels: data.fields.labels || [],
                components: (data.fields.components || []).map((c: any) => c.name),
                type: data.fields.issuetype?.name,
                project: {
                    key: data.fields.project?.key,
                    name: data.fields.project?.name,
                },
                success: true,
            },
        }
    },
    
    transformError: (error: any) => {
        return error.message || 'Failed to retrieve Jira issue'
    },
}