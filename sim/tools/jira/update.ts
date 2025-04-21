import { ToolConfig } from '../types'
import { JiraUpdateResponse, JiraUpdateParams } from './types'
import { getJiraCloudId } from './utils'

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
            'write:issue:jira'
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
        url: (params) => {
            try {
                const { domain, issueKey } = params
                if (!domain || !issueKey) {
                    throw new Error('Domain and issueKey are required')
                }
                
                const cloudId = params.cloudId || getJiraCloudId(domain, params.accessToken)
                if (!cloudId) {
                    throw new Error('Failed to get Jira Cloud ID')
                }
                
                console.log('Using cloudId:', cloudId)
                const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}`
                console.log('Generated URL:', url)
                return url
            } catch (error) {
                console.error('Error generating URL:', error)
                throw error
            }
        },
        method: 'PUT',
        headers: (params) => ({
            'Authorization': `Bearer ${params.accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }),
        body: (params) => {
            const fields: Record<string, any> = {}
            
            if (params.summary) {
                fields.summary = params.summary
            }

            if (params.description) {
                fields.description = {
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

            if (params.status) {
                fields.status = {
                    name: params.status
                }
            }

            if (params.priority) {
                fields.priority = {
                    name: params.priority
                }
            }

            if (params.assignee) {
                fields.assignee = {
                    id: params.assignee
                }
            }

            console.log('Request body:', { fields })
            return { fields }
        }
    },
    
    transformResponse: async (response: Response) => {
        if (!response.ok) {
            const responseText = await response.text()
            console.log('Error response from Jira:', {
                status: response.status,
                statusText: response.statusText,
                responseText,
                headers: Object.fromEntries(response.headers.entries())
            })

            try {
                const data = JSON.parse(responseText)
                throw new Error(
                    data.errorMessages?.[0] || 
                    data.errors?.[Object.keys(data.errors)[0]] || 
                    data.message || 
                    'Failed to update Jira issue'
                )
            } catch (e) {
                throw new Error(`Jira API error: ${responseText}`)
            }
        }

        const data = await response.json()
        return {
            success: true,
            output: {
                ts: new Date().toISOString(),
                issueKey: data.key || '',
                summary: data.fields?.summary || 'Issue updated',
                success: true
            },
        }
    },
    
    transformError: (error: any) => {
        console.error('Jira update error:', error)
        return error.message || 'Failed to update Jira issue'
    }
}