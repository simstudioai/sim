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
        cloudId: {
            type: 'string',
            required: true,
            description: 'Jira Cloud ID for the instance',
        },
        issueKey: {
            type: 'string',
            required: true,
            description: 'Jira issue key to retrieve (e.g., PROJ-123)',
        },
    },
    
    request: { //TODO: the cloudID is not getting populated with the 404 error, look into adding this cloudID to the params
        url: (params: JiraRetrieveParams) => {
            // The cloudId is handled in transformResponse since we need to fetch it first
            return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}?expand=renderedFields,names,schema,transitions,operations,editmeta,changelog`
        },
        method: 'GET',
        headers: (params: JiraRetrieveParams) => {
            return {
                'Accept': 'application/json',
                'Authorization': `Bearer ${params.accessToken}`,
            }
        },
    },
    
    transformResponse: async (response: Response, params?: JiraRetrieveParams) => {
        if (!params) {
            throw new Error('Parameters are required for Jira issue retrieval');
        }

        const accessibleResourcesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${params.accessToken}`,
                'Accept': 'application/json'
            }
        });

        if (!accessibleResourcesRes.ok) {
            throw new Error('Failed to fetch accessible resources');
        }

        const accessibleResources = await accessibleResourcesRes.json();
        const normalizedInput = `https://${params.domain}`.toLowerCase();
        const matchedResource = accessibleResources.find((r: any) => r.url.toLowerCase() === normalizedInput);

        if (!matchedResource) {
            throw new Error('Could not find matching Jira site for provided domain');
        }

        const cloudId = matchedResource.id;
        console.log('Cloud ID:', cloudId);
        console.log('Issue Key:', params.issueKey);
        console.log('matchedResource:', matchedResource);
        const issueUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params.issueKey}?expand=renderedFields,names,schema,transitions,operations,editmeta,changelog`;
        const issueResponse = await fetch(issueUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${params.accessToken}`,
            }
        });

        const data = await issueResponse.json();
        if (!issueResponse.ok) {
            throw new Error(data.message || 'Failed to retrieve Jira issue');
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