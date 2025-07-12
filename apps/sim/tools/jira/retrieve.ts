import type { ToolConfig } from '../types'
import type { JiraRetrieveParams, JiraRetrieveResponse } from './types'

export const jiraRetrieveTool: ToolConfig<JiraRetrieveParams, JiraRetrieveResponse> = {
  id: 'jira_retrieve',
  name: 'Jira Retrieve',
  description: 'Retrieve detailed information about a specific Jira issue',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
    additionalScopes: ['read:jira-work', 'read:jira-user', 'read:me', 'offline_access'],
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
        'Jira project ID to retrieve issues from. If not provided, all issues will be retrieved.',
    },
    issueKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jira issue key to retrieve (e.g., PROJ-123)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: JiraRetrieveParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}?expand=renderedFields,names,schema,transitions,operations,editmeta,changelog`
      }
      // If no cloudId, use the accessible resources endpoint
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraRetrieveParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params?: JiraRetrieveParams) => {
    if (!params) {
      throw new Error('Parameters are required for Jira issue retrieval')
    }

    try {
      // If we don't have a cloudId, we need to fetch it first
      if (!params.cloudId) {
        if (!response.ok) {
          const errorData = await response.json().catch(() => null)
          throw new Error(
            errorData?.message ||
              `Failed to fetch accessible resources: ${response.status} ${response.statusText}`
          )
        }

        const accessibleResources = await response.json()
        if (!Array.isArray(accessibleResources) || accessibleResources.length === 0) {
          throw new Error('No accessible Jira resources found for this account')
        }

        const normalizedInput = `https://${params.domain}`.toLowerCase()
        const matchedResource = accessibleResources.find(
          (r) => r.url.toLowerCase() === normalizedInput
        )

        if (!matchedResource) {
          throw new Error(`Could not find matching Jira site for domain: ${params.domain}`)
        }

        // Now fetch the actual issue with the found cloudId
        const issueUrl = `https://api.atlassian.com/ex/jira/${matchedResource.id}/rest/api/3/issue/${params.issueKey}?expand=renderedFields,names,schema,transitions,operations,editmeta,changelog`
        const issueResponse = await fetch(issueUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${params.accessToken}`,
          },
        })

        if (!issueResponse.ok) {
          const errorData = await issueResponse.json().catch(() => null)
          throw new Error(
            errorData?.message ||
              `Failed to retrieve Jira issue: ${issueResponse.status} ${issueResponse.statusText}`
          )
        }

        const data = await issueResponse.json()
        if (!data || !data.fields) {
          throw new Error('Invalid response format from Jira API')
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
          },
        }
      }

      // If we have a cloudId, this response is the issue data
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(
          errorData?.message ||
            `Failed to retrieve Jira issue: ${response.status} ${response.statusText}`
        )
      }

      const data = await response.json()
      if (!data || !data.fields) {
        throw new Error('Invalid response format from Jira API')
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
        },
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error))
    }
  },

  transformError: (error: any) => {
    return error.message || 'Failed to retrieve Jira issue'
  },
}
