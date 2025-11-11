import { createLogger } from '@/lib/logs/console/logger'
import type { JiraRetrieveParams, JiraRetrieveResponse } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('JiraRetrieveTool')

export const jiraRetrieveTool: ToolConfig<JiraRetrieveParams, JiraRetrieveResponse> = {
  id: 'jira_retrieve',
  name: 'Jira Retrieve',
  description: 'Retrieve detailed information about a specific Jira issue',
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
        // Request with broad expands; additional endpoints fetched in transform for completeness
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}?expand=renderedFields,names,schema,transitions,operations,editmeta,changelog,versionedRepresentations`
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
      const issueUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params?.issueKey}?expand=renderedFields,names,schema,transitions,operations,editmeta,changelog,versionedRepresentations`
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

      // Fetch additional resources for a comprehensive view
      const base = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params.issueKey}`
      const [commentsResp, worklogResp, watchersResp] = await Promise.all([
        fetch(`${base}/comment?maxResults=100&orderBy=-created`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${params!.accessToken}` },
        }),
        fetch(`${base}/worklog?maxResults=100`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${params!.accessToken}` },
        }),
        fetch(`${base}/watchers`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${params!.accessToken}` },
        }),
      ])

      try {
        if (commentsResp.ok) {
          const commentsData = await commentsResp.json()
          if (data?.fields) data.fields.comment = commentsData?.comments || data.fields.comment
        } else {
          logger.debug?.('Failed to fetch comments', { status: commentsResp.status })
        }
      } catch {}

      try {
        if (worklogResp.ok) {
          const worklogData = await worklogResp.json()
          if (data?.fields) data.fields.worklog = worklogData || data.fields.worklog
        } else {
          logger.debug?.('Failed to fetch worklog', { status: worklogResp.status })
        }
      } catch {}

      try {
        if (watchersResp.ok) {
          const watchersData = await watchersResp.json()
          if (data?.fields) {
            // Provide both common keys for compatibility
            ;(data.fields as any).watcher = watchersData
            ;(data.fields as any).watches = watchersData
          }
        } else {
          logger.debug?.('Failed to fetch watchers', { status: watchersResp.status })
        }
      } catch {}

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: data?.key,
          summary: data?.fields?.summary,
          description: data?.fields?.description,
          created: data?.fields?.created,
          updated: data?.fields?.updated,
          issue: data,
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

    // When cloudId was provided up-front, fetch additional data too
    try {
      const url = new URL(response.url)
      const match = url.pathname.match(/\/ex\/jira\/([^/]+)/)
      const cloudId = match?.[1]
      if (cloudId) {
        const base = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params.issueKey}`
        const [commentsResp, worklogResp, watchersResp] = await Promise.all([
          fetch(`${base}/comment?maxResults=100&orderBy=-created`, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${params!.accessToken}` },
          }),
          fetch(`${base}/worklog?maxResults=100`, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${params!.accessToken}` },
          }),
          fetch(`${base}/watchers`, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${params!.accessToken}` },
          }),
        ])

        try {
          if (commentsResp.ok) {
            const commentsData = await commentsResp.json()
            if (data?.fields) data.fields.comment = commentsData?.comments || data.fields.comment
          }
        } catch {}

        try {
          if (worklogResp.ok) {
            const worklogData = await worklogResp.json()
            if (data?.fields) data.fields.worklog = worklogData || data.fields.worklog
          }
        } catch {}

        try {
          if (watchersResp.ok) {
            const watchersData = await watchersResp.json()
            if (data?.fields) {
              ;(data.fields as any).watcher = watchersData
              ;(data.fields as any).watches = watchersData
            }
          }
        } catch {}
      }
    } catch {}

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: data?.key,
        summary: data?.fields?.summary,
        description: data?.fields?.description,
        created: data?.fields?.created,
        updated: data?.fields?.updated,
        issue: data,
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
