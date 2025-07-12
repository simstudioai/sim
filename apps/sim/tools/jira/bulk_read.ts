import type { ToolConfig } from '../types'
import type { JiraRetrieveBulkParams, JiraRetrieveResponseBulk } from './types'

export const jiraBulkRetrieveTool: ToolConfig<JiraRetrieveBulkParams, JiraRetrieveResponseBulk> = {
  id: 'jira_bulk_read',
  name: 'Jira Bulk Read',
  description: 'Retrieve multiple Jira issues in bulk',
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
      required: true,
      visibility: 'user-only',
      description: 'Jira project ID',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Jira cloud ID',
    },
  },
  request: {
    url: (params: JiraRetrieveBulkParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/picker?currentJQL=project=${params.projectId}`
      }
      // If no cloudId, use the accessible resources endpoint
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraRetrieveBulkParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
    body: (params: JiraRetrieveBulkParams) => ({}),
  },
  transformResponse: async (response: Response, params?: JiraRetrieveBulkParams) => {
    if (!params) {
      throw new Error('Parameters are required for Jira bulk issue retrieval')
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

        // First get issue keys from picker
        const pickerUrl = `https://api.atlassian.com/ex/jira/${matchedResource.id}/rest/api/3/issue/picker?currentJQL=project=${params.projectId}`
        const pickerResponse = await fetch(pickerUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            Accept: 'application/json',
          },
        })

        if (!pickerResponse.ok) {
          const errorData = await pickerResponse.json().catch(() => null)
          throw new Error(
            errorData?.message ||
              `Failed to retrieve issue keys: ${pickerResponse.status} ${pickerResponse.statusText}`
          )
        }

        const pickerData = await pickerResponse.json()
        const issueKeys = pickerData.sections
          .flatMap((section: any) => section.issues || [])
          .map((issue: any) => issue.key)

        if (issueKeys.length === 0) {
          return {
            success: true,
            output: [],
          }
        }

        // Now use bulkfetch to get the full issue details
        const bulkfetchUrl = `https://api.atlassian.com/ex/jira/${matchedResource.id}/rest/api/3/issue/bulkfetch`
        const bulkfetchResponse = await fetch(bulkfetchUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            expand: ['names'],
            fields: ['summary', 'description', 'created', 'updated'],
            fieldsByKeys: false,
            issueIdsOrKeys: issueKeys,
            properties: [],
          }),
        })

        if (!bulkfetchResponse.ok) {
          const errorData = await bulkfetchResponse.json().catch(() => null)
          throw new Error(
            errorData?.message ||
              `Failed to retrieve Jira issues: ${bulkfetchResponse.status} ${bulkfetchResponse.statusText}`
          )
        }

        const data = await bulkfetchResponse.json()
        return {
          success: true,
          output: data.issues.map((issue: any) => ({
            ts: new Date().toISOString(),
            summary: issue.fields.summary,
            description: issue.fields.description?.content?.[0]?.content?.[0]?.text || '',
            created: issue.fields.created,
            updated: issue.fields.updated,
          })),
        }
      }

      // If we have a cloudId, this response is from the issue picker
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(
          errorData?.message ||
            `Failed to retrieve issue keys: ${response.status} ${response.statusText}`
        )
      }

      const pickerData = await response.json()
      const issueKeys = pickerData.sections
        .flatMap((section: any) => section.issues || [])
        .map((issue: any) => issue.key)

      if (issueKeys.length === 0) {
        return {
          success: true,
          output: [],
        }
      }

      // Use bulkfetch to get the full issue details
      const bulkfetchUrl = `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/bulkfetch`
      const bulkfetchResponse = await fetch(bulkfetchUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expand: ['names'],
          fields: ['summary', 'description', 'created', 'updated'],
          fieldsByKeys: false,
          issueIdsOrKeys: issueKeys,
          properties: [],
        }),
      })

      if (!bulkfetchResponse.ok) {
        const errorData = await bulkfetchResponse.json().catch(() => null)
        throw new Error(
          errorData?.message ||
            `Failed to retrieve Jira issues: ${bulkfetchResponse.status} ${bulkfetchResponse.statusText}`
        )
      }

      const data = await bulkfetchResponse.json()
      return {
        success: true,
        output: data.issues.map((issue: any) => ({
          ts: new Date().toISOString(),
          summary: issue.fields.summary,
          description: issue.fields.description?.content?.[0]?.content?.[0]?.text || '',
          created: issue.fields.created,
          updated: issue.fields.updated,
        })),
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error))
    }
  },
  transformError: (error: any) => {
    return error.message || 'Failed to retrieve Jira issues'
  },
}
