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
      // Always return accessible resources endpoint; transformResponse will build search URLs
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraRetrieveBulkParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
    body: (params: JiraRetrieveBulkParams) =>
      params.cloudId
        ? {
            jql: '', // Will be set in transformResponse when we know the resolved project key
            startAt: 0,
            maxResults: 100,
            fields: ['summary', 'description', 'created', 'updated'],
          }
        : {},
  },

  transformResponse: async (response: Response, params?: JiraRetrieveBulkParams) => {
    const MAX_TOTAL = 1000
    const PAGE_SIZE = 100

    // Helper to extract description text safely (ADF can be nested)
    const extractDescription = (desc: any): string => {
      try {
        return (
          desc?.content?.[0]?.content?.[0]?.text ||
          desc?.content?.flatMap((c: any) => c?.content || [])?.find((c: any) => c?.text)?.text ||
          ''
        )
      } catch (_e) {
        return ''
      }
    }

    // Helper to resolve a project reference (id or key) to its canonical key
    const resolveProjectKey = async (cloudId: string, accessToken: string, ref: string) => {
      const refTrimmed = (ref || '').trim()
      if (!refTrimmed) return refTrimmed
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${encodeURIComponent(refTrimmed)}`
      const resp = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      })
      if (!resp.ok) {
        // If can't resolve, fall back to original ref (JQL can still work with id or key)
        return refTrimmed
      }
      const project = await resp.json()
      return project?.key || refTrimmed
    }

    // If we don't have a cloudId, look it up first
    if (!params?.cloudId) {
      const accessibleResources = await response.json()
      const normalizedInput = `https://${params?.domain}`.toLowerCase()
      const matchedResource = accessibleResources.find(
        (r: any) => r.url.toLowerCase() === normalizedInput
      )

      const projectKey = await resolveProjectKey(
        matchedResource.id,
        params!.accessToken,
        params!.projectId
      )
      const jql = `project = ${projectKey} ORDER BY updated DESC`

      let startAt = 0
      let collected: any[] = []
      let total = 0

      while (startAt < MAX_TOTAL) {
        const queryParams = new URLSearchParams({
          jql,
          fields: 'summary,description,created,updated',
          maxResults: String(PAGE_SIZE),
        })
        if (startAt > 0) {
          queryParams.set('startAt', String(startAt))
        }
        const url = `https://api.atlassian.com/ex/jira/${matchedResource.id}/rest/api/3/search/jql?${queryParams.toString()}`
        const pageResponse = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${params?.accessToken}`,
            Accept: 'application/json',
          },
        })

        const pageData = await pageResponse.json()
        const issues = pageData.issues || []
        total = pageData.total || issues.length
        collected = collected.concat(issues)

        if (collected.length >= Math.min(total, MAX_TOTAL) || issues.length === 0) break
        startAt += PAGE_SIZE
      }

      return {
        success: true,
        output: collected.slice(0, MAX_TOTAL).map((issue: any) => ({
          ts: new Date().toISOString(),
          summary: issue.fields?.summary,
          description: extractDescription(issue.fields?.description),
          created: issue.fields?.created,
          updated: issue.fields?.updated,
        })),
      }
    }

    // cloudId present: resolve project and paginate using the Search API
    // Resolve to canonical project key for consistent JQL
    const projectKey = await resolveProjectKey(
      params!.cloudId!,
      params!.accessToken,
      params!.projectId
    )

    const jql = `project = ${projectKey} ORDER BY updated DESC`

    // Always do full pagination with resolved key
    let collected: any[] = []
    let total = 0
    let startAt = 0
    while (startAt < MAX_TOTAL) {
      const queryParams = new URLSearchParams({
        jql,
        fields: 'summary,description,created,updated',
        maxResults: String(PAGE_SIZE),
      })
      if (startAt > 0) {
        queryParams.set('startAt', String(startAt))
      }
      const url = `https://api.atlassian.com/ex/jira/${params?.cloudId}/rest/api/3/search/jql?${queryParams.toString()}`
      const pageResponse = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params?.accessToken}`,
          Accept: 'application/json',
        },
      })
      const pageData = await pageResponse.json()
      const issues = pageData.issues || []
      total = pageData.total || issues.length
      collected = collected.concat(issues)
      if (issues.length === 0 || collected.length >= Math.min(total, MAX_TOTAL)) break
      startAt += PAGE_SIZE
    }

    return {
      success: true,
      output: collected.slice(0, MAX_TOTAL).map((issue: any) => ({
        ts: new Date().toISOString(),
        summary: issue.fields?.summary,
        description: extractDescription(issue.fields?.description),
        created: issue.fields?.created,
        updated: issue.fields?.updated,
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
