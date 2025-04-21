import { ToolConfig } from '../types'
import { JiraWriteResponse, JiraWriteParams } from './types'
import { getJiraCloudId } from './utils'

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
            'read:issue:jira',
            'write:issue:jira',
            'write:comment:jira',
            'write:comment.property:jira',
            'write:attachment:jira',
            'read:attachment:jira',
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
        projectId: {
            type: 'string',
            required: true,
            description: 'Project ID for the issue',
        },
        summary: {
            type: 'string',
            required: true,
            description: 'Summary for the issue',
        },
        description: {
            type: 'string',
            required: false,
            description: 'Description for the issue',
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
        cloudId: {
            type: 'string',
            required: false,
            description: 'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
        },
        parent: {
            type: 'object',
            required: false,
            description: 'Parent issue key for creating subtasks. Format: { key: "ISSUE-123" }',
        },
        issueType: {
            type: 'string',
            required: true,
            description: 'Type of issue to create (e.g., Task, Story, Bug, Sub-task)',
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
            const { domain, cloudId } = params
            if (!domain || !cloudId) {
                throw new Error('Domain and cloudId are required')
            }
            
            console.log('Using cloudId:', cloudId)
            const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`
            console.log('Generated URL:', url)
            return url
        },
        method: 'POST',
        headers: (params) => ({
            'Authorization': `Bearer ${params.accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }),
        body: (params) => {
            console.log('Full params object received in write tool:', params)
            
            // Validate required fields
            if (!params.projectId) {
                throw new Error('Project ID is required')
            }
            if (!params.summary) {
                throw new Error('Summary is required')
            }
            if (!params.issueType) {
                throw new Error('Issue type is required')
            }
            
            // Construct fields object with only the necessary fields
            const fields: Record<string, any> = {
                project: {
                    id: params.projectId
                },
                issuetype: {
                    name: params.issueType
                },
                summary: params.summary // Use the summary field directly
            }
            
            // Only add description if it exists
            if (params.description) {
                console.log('Setting description:', params.description)
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

            // Only add parent if it exists
            if (params.parent) {
                console.log('Setting parent:', params.parent)
                fields.parent = params.parent
            }

            const body = { fields }
            console.log('Final request body:', body)
            return body
        }
    },

    transformResponse: async (response: Response, params?: JiraWriteParams) => {
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
                        'Failed to create Jira issue'
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
                return {
                    success: true,
                    output: {
                        ts: new Date().toISOString(),
                        issueKey: 'unknown',
                        summary: 'Issue created successfully',
                        success: true,
                        url: ''
                    },
                }
            }

            const data = JSON.parse(responseText)
            return {
                success: true,
                output: {
                    ts: new Date().toISOString(),
                    issueKey: data.key || 'unknown',
                    summary: data.fields?.summary || 'Issue created',
                    success: true,
                    url: `https://${params?.domain}/browse/${data.key}`
                },
            }
        } catch (e) {
            console.error('Error parsing successful response:', e)
            return {
                success: true,
                output: {
                    ts: new Date().toISOString(),
                    issueKey: 'unknown',
                    summary: 'Issue created (response parsing failed)',
                    success: true,
                    url: ''
                },
            }
        }
    },

    transformError: (error: any) => {
        console.error('Jira write error:', error)
        return error.message || 'Failed to create Jira issue'
    }
}