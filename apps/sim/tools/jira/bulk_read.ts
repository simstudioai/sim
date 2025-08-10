import type { JiraRetrieveBulkParams, JiraRetrieveResponseBulk } from '@/tools/jira/types'
import type { ToolConfig } from '@/tools/types'

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
    // If we don't have a cloudId, we need to fetch it first
    if (!params?.cloudId) {
      const accessibleResources = await response.json()
      const normalizedInput = `https://${params?.domain}`.toLowerCase()
      const matchedResource = accessibleResources.find(
        (r: any) => r.url.toLowerCase() === normalizedInput
      )

      // First get issue keys from picker
      const pickerUrl = `https://api.atlassian.com/ex/jira/${matchedResource.id}/rest/api/3/issue/picker?currentJQL=project=${params?.projectId}`
      const pickerResponse = await fetch(pickerUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params?.accessToken}`,
          Accept: 'application/json',
        },
      })

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
          Authorization: `Bearer ${params?.accessToken}`,
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
    const bulkfetchUrl = `https://api.atlassian.com/ex/jira/${params?.cloudId}/rest/api/3/issue/bulkfetch`
    const bulkfetchResponse = await fetch(bulkfetchUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params?.accessToken}`,
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
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Operation success status',
    },
    output: {
      type: 'array',
      description: 'Array of Jira issues with summary, description, created and updated timestamps',
    },
  },
}
