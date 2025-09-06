import type { JiraRetrieveParams, JiraRetrieveResponse } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

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
      description: 'Jira project ID (optional; not required to retrieve a single issue).',
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
    if (!params?.issueKey) {
      throw new Error(
        'Select a project to read issues, or provide an issue key to read a single issue.'
      )
    }

    // If we don't have a cloudId, resolve it robustly using the Jira utils helper
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      // Now fetch the actual issue with the found cloudId
      const issueUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params?.issueKey}?expand=renderedFields,names,schema,transitions,operations,editmeta,changelog`
      const issueResponse = await fetch(issueUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params?.accessToken}`,
        },
      })

      if (!issueResponse.ok) {
        let message = `Failed to fetch Jira issue (${issueResponse.status})`
        try {
          const err = await issueResponse.json()
          message = err?.message || err?.errorMessages?.[0] || message
        } catch (_e) {}
        throw new Error(message)
      }

      const data = await issueResponse.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: data?.key,
          summary: data?.fields?.summary,
          description: data?.fields?.description,
          created: data?.fields?.created,
          updated: data?.fields?.updated,
        },
      }
    }

    // If we have a cloudId, this response is the issue data
    if (!response.ok) {
      let message = `Failed to fetch Jira issue (${response.status})`
      try {
        const err = await response.json()
        message = err?.message || err?.errorMessages?.[0] || message
      } catch (_e) {}
      throw new Error(message)
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: data?.key,
        summary: data?.fields?.summary,
        description: data?.fields?.description,
        created: data?.fields?.created,
        updated: data?.fields?.updated,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Operation success status',
    },
    output: {
      type: 'object',
      description:
        'Jira issue details with issue key, summary, description, created and updated timestamps',
    },
  },
}
