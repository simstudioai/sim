import type { JiraRetrieveBulkParams, JiraRetrieveResponseBulk } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { extractAdfText } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraBulkRetrieveTool: ToolConfig<JiraRetrieveBulkParams, JiraRetrieveResponseBulk> = {
  id: 'jira_bulk_read',
  name: 'Jira Bulk Read',
  description: 'Retrieve multiple Jira issues from a project in bulk',
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
      visibility: 'user-or-llm',
      description: 'Jira project key (e.g., PROJ)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: () => 'https://api.atlassian.com/oauth/token/accessible-resources',
    method: 'GET',
    headers: (params: JiraRetrieveBulkParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response, params?: JiraRetrieveBulkParams) => {
    const MAX_TOTAL = 1000
    const PAGE_SIZE = 100

    const resolveProjectKey = async (cloudId: string, accessToken: string, ref: string) => {
      const refTrimmed = (ref || '').trim()
      if (!refTrimmed) return refTrimmed
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${encodeURIComponent(refTrimmed)}`
      const resp = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      })
      if (!resp.ok) return refTrimmed
      const project = await resp.json()
      return project?.key || refTrimmed
    }

    const resolveCloudId = async () => {
      if (params?.cloudId) return params.cloudId
      const accessibleResources = await response.json()
      const normalizedInput = `https://${params?.domain}`.toLowerCase()
      const matchedResource = accessibleResources.find(
        (r: any) => r.url.toLowerCase() === normalizedInput
      )
      if (matchedResource) return matchedResource.id
      if (Array.isArray(accessibleResources) && accessibleResources.length > 0)
        return accessibleResources[0].id
      throw new Error('No Jira resources found')
    }

    const cloudId = await resolveCloudId()
    const projectKey = await resolveProjectKey(cloudId, params!.accessToken, params!.projectId)
    const jql = `project = ${projectKey} ORDER BY updated DESC`

    let collected: any[] = []
    let nextPageToken: string | undefined
    let total: number | null = null

    while (collected.length < MAX_TOTAL) {
      const queryParams = new URLSearchParams({
        jql,
        fields: 'summary,description,status,issuetype,priority,assignee,created,updated',
        maxResults: String(PAGE_SIZE),
      })
      if (nextPageToken) queryParams.set('nextPageToken', nextPageToken)

      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql?${queryParams.toString()}`
      const pageResponse = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params!.accessToken}`,
          Accept: 'application/json',
        },
      })

      if (!pageResponse.ok) {
        let message = `Failed to bulk read Jira issues (${pageResponse.status})`
        try {
          const err = await pageResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      const pageData = await pageResponse.json()
      const issues = pageData.issues || []
      if (pageData.total != null) total = pageData.total
      collected = collected.concat(issues)

      if (pageData.isLast || !pageData.nextPageToken || issues.length === 0) break
      nextPageToken = pageData.nextPageToken
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        total,
        issues: collected.slice(0, MAX_TOTAL).map((issue: any) => ({
          id: issue.id ?? '',
          key: issue.key ?? '',
          self: issue.self ?? '',
          summary: issue.fields?.summary ?? '',
          description: extractAdfText(issue.fields?.description),
          status: {
            id: issue.fields?.status?.id ?? '',
            name: issue.fields?.status?.name ?? '',
          },
          issuetype: {
            id: issue.fields?.issuetype?.id ?? '',
            name: issue.fields?.issuetype?.name ?? '',
          },
          priority: issue.fields?.priority
            ? { id: issue.fields.priority.id ?? '', name: issue.fields.priority.name ?? '' }
            : null,
          assignee: issue.fields?.assignee
            ? {
                accountId: issue.fields.assignee.accountId ?? '',
                displayName: issue.fields.assignee.displayName ?? '',
              }
            : null,
          created: issue.fields?.created ?? '',
          updated: issue.fields?.updated ?? '',
        })),
        nextPageToken: nextPageToken ?? null,
        isLast: !nextPageToken || collected.length >= MAX_TOTAL,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    total: {
      type: 'number',
      description: 'Total number of issues in the project (may not always be available)',
      optional: true,
    },
    issues: {
      type: 'array',
      description: 'Array of Jira issues',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Issue ID' },
          key: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
          self: { type: 'string', description: 'REST API URL for this issue' },
          summary: { type: 'string', description: 'Issue summary' },
          description: { type: 'string', description: 'Issue description text', optional: true },
          status: {
            type: 'object',
            description: 'Issue status',
            properties: {
              id: { type: 'string', description: 'Status ID' },
              name: { type: 'string', description: 'Status name' },
            },
          },
          issuetype: {
            type: 'object',
            description: 'Issue type',
            properties: {
              id: { type: 'string', description: 'Issue type ID' },
              name: { type: 'string', description: 'Issue type name' },
            },
          },
          priority: {
            type: 'object',
            description: 'Issue priority',
            properties: {
              id: { type: 'string', description: 'Priority ID' },
              name: { type: 'string', description: 'Priority name' },
            },
            optional: true,
          },
          assignee: {
            type: 'object',
            description: 'Assigned user',
            properties: {
              accountId: { type: 'string', description: 'Atlassian account ID' },
              displayName: { type: 'string', description: 'Display name' },
            },
            optional: true,
          },
          created: { type: 'string', description: 'ISO 8601 creation timestamp' },
          updated: { type: 'string', description: 'ISO 8601 last updated timestamp' },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Cursor token for the next page. Null when no more results.',
      optional: true,
    },
    isLast: { type: 'boolean', description: 'Whether this is the last page of results' },
  },
}
