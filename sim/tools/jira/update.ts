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
            'write:issue:jira',
            'read:jira-work',
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
    
    directExecution: async (params) => {
        // Pre-fetch the cloudId if not provided
        if (!params.cloudId) {
            try {
                params.cloudId = await getJiraCloudId(params.domain, params.accessToken)
                console.log('Pre-fetched cloudId:', params.cloudId)
            } catch (error) {
                console.error('Error pre-fetching cloudId:', error)
                throw error
            }
        }
        return undefined // Let the regular request handling take over
    },
    
    request: {
        url: (params) => {
            const { domain, issueKey, cloudId } = params
            if (!domain || !issueKey || !cloudId) {
                throw new Error('Domain, issueKey, and cloudId are required')
            }
            
            console.log('Using cloudId:', cloudId)
            const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}`
            console.log('Generated URL:', url)
            return url
        },
        method: 'PUT',
        headers: (params) => ({
            'Authorization': `Bearer ${params.accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }),
        body: (params) => {
            console.log('Full params object received in update tool:', params)
            
            // Map the summary from either summary or title field
            const summaryValue = params.summary || params.title
            const descriptionValue = params.description
            
            console.log('Update params received:', {
                summary: summaryValue,
                description: descriptionValue,
                status: params.status,
                priority: params.priority,
                assignee: params.assignee
            })
            
            const fields: Record<string, any> = {}
            
            if (summaryValue) {
                console.log('Setting summary:', summaryValue)
                fields.summary = summaryValue
            } else {
                console.log('Summary is undefined or empty')
            }

            if (descriptionValue) {
                console.log('Setting description:', descriptionValue)
                fields.description = {
                    type: 'doc',
                    version: 1,
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: descriptionValue
                                }
                            ]
                        }
                    ]
                }
            } else {
                console.log('Description is undefined or empty')
            }

            if (params.status) {
                console.log('Setting status:', params.status)
                fields.status = {
                    name: params.status
                }
            }

            if (params.priority) {
                console.log('Setting priority:', params.priority)
                fields.priority = {
                    name: params.priority
                }
            }

            if (params.assignee) {
                console.log('Setting assignee:', params.assignee)
                fields.assignee = {
                    id: params.assignee
                }
            }

            console.log('Final request body:', { fields })
            return { fields }
        }
    },
    
    transformResponse: async (response: Response, params?: JiraUpdateParams) => {
        // Log the response details for debugging
        const responseText = await response.text()
        console.log('Raw response:', {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseText
        })

        if (!response.ok) {
            try {
                if (responseText) {
                    const data = JSON.parse(responseText)
                    throw new Error(
                        data.errorMessages?.[0] || 
                        data.errors?.[Object.keys(data.errors)[0]] || 
                        data.message || 
                        'Failed to update Jira issue'
                    )
                } else {
                    throw new Error(`Request failed with status ${response.status}: ${response.statusText}`)
                }
            } catch (e) {
                if (e instanceof SyntaxError) {
                    // If we can't parse the response as JSON, return the raw text
                    throw new Error(`Jira API error (${response.status}): ${responseText}`)
                }
                throw e
            }
        }

        // For successful responses
        try {
            if (!responseText) {
                // Some successful PUT requests might return no content
                return {
                    success: true,
                    output: {
                        ts: new Date().toISOString(),
                        issueKey: params?.issueKey || 'unknown',
                        summary: 'Issue updated successfully',
                        success: true
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
                    success: true
                },
            }
        } catch (e) {
            console.error('Error parsing successful response:', e)
            // If we can't parse the response but it was successful, still return success
            return {
                success: true,
                output: {
                    ts: new Date().toISOString(),
                    issueKey: params?.issueKey || 'unknown',
                    summary: 'Issue updated (response parsing failed)',
                    success: true
                },
            }
        }
    },
    
    transformError: (error: any) => {
        console.error('Jira update error:', error)
        return error.message || 'Failed to update Jira issue'
    }
}