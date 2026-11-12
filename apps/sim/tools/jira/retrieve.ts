import { createLogger } from '@sim/logger'
import {
  AttachmentDownloadBudget,
  readAttachmentJson,
  rethrowAttachmentDownloadError,
} from '@/lib/uploads/utils/attachment-download-budget'
import type { JiraRetrieveParams, JiraRetrieveResponse } from '@/tools/jira/types'
import { ISSUE_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { downloadJiraAttachments, getJiraCloudId, transformIssueData } from '@/tools/jira/utils'
import type { ToolConfig, ToolResponseContext } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
      visibility: 'user-or-llm',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    issueKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Jira issue key to retrieve (e.g., PROJ-123)',
    },
    includeAttachments: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Download attachment file contents and include them as files in the output',
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
    url: (params: JiraRetrieveParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${safeUrlPathSegment(params.issueKey, 'issueKey')}?expand=renderedFields,names,schema,transitions,operations,editmeta,changelog,versionedRepresentations`
      }
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

  transformResponse: async (
    response: Response,
    params?: JiraRetrieveParams,
    context?: ToolResponseContext
  ) => {
    const budget = new AttachmentDownloadBudget(context)
    context?.signal?.throwIfAborted()
    if (!params?.issueKey) {
      throw new Error('Provide an issue key to retrieve a single issue.')
    }

    const fetchIssue = async (cloudId: string) => {
      const issueUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${safeUrlPathSegment(params.issueKey, 'issueKey')}?expand=renderedFields,names,schema,transitions,operations,editmeta,changelog,versionedRepresentations`
      const issueResponse = await fetch(issueUrl, {
        method: 'GET',
        signal: context?.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params.accessToken}`,
        },
      })

      if (!issueResponse.ok) {
        let message = `Failed to fetch Jira issue (${issueResponse.status})`
        try {
          const err = await readAttachmentJson<{ message?: string; errorMessages?: string[] }>(
            issueResponse,
            'Jira error response',
            context?.signal
          )
          message = err?.message || err?.errorMessages?.[0] || message
        } catch (_e) {
          rethrowAttachmentDownloadError(_e, context?.signal)
        }
        throw new Error(message)
      }

      return readAttachmentJson<Record<string, unknown>>(
        issueResponse,
        'Jira attachment metadata',
        context?.signal
      )
    }

    const fetchSupplementary = async (cloudId: string, data: any) => {
      const base = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${safeUrlPathSegment(params.issueKey, 'issueKey')}`
      const [commentsResp, worklogResp, watchersResp] = await Promise.all([
        fetch(`${base}/comment?maxResults=100&orderBy=-created`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${params.accessToken}` },
          signal: context?.signal,
        }),
        fetch(`${base}/worklog?maxResults=100`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${params.accessToken}` },
          signal: context?.signal,
        }),
        fetch(`${base}/watchers`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${params.accessToken}` },
          signal: context?.signal,
        }),
      ])

      try {
        if (commentsResp.ok) {
          const commentsData = await readAttachmentJson<{ comments?: unknown[] }>(
            commentsResp,
            'Jira comments',
            context?.signal
          )
          if (data?.fields) data.fields.comment = commentsData?.comments || data.fields.comment
        }
      } catch (error) {
        rethrowAttachmentDownloadError(error, context?.signal)
        logger.debug?.('Failed to fetch comments')
      }

      try {
        if (worklogResp.ok) {
          const worklogData = await readAttachmentJson<Record<string, unknown>>(
            worklogResp,
            'Jira worklog',
            context?.signal
          )
          if (data?.fields) data.fields.worklog = worklogData || data.fields.worklog
        }
      } catch (error) {
        rethrowAttachmentDownloadError(error, context?.signal)
        logger.debug?.('Failed to fetch worklog')
      }

      try {
        if (watchersResp.ok) {
          const watchersData = await readAttachmentJson<Record<string, unknown>>(
            watchersResp,
            'Jira watchers',
            context?.signal
          )
          if (data?.fields) {
            data.fields.watches = watchersData
          }
        }
      } catch (error) {
        rethrowAttachmentDownloadError(error, context?.signal)
        logger.debug?.('Failed to fetch watchers')
      }
    }

    let data: any

    if (!params.cloudId) {
      const cloudId = await getJiraCloudId(params.domain, params.accessToken, {
        signal: context?.signal,
      })
      data = await fetchIssue(cloudId)
      await fetchSupplementary(cloudId, data)
    } else {
      if (!response.ok) {
        let message = `Failed to fetch Jira issue (${response.status})`
        try {
          const err = await readAttachmentJson<{ message?: string; errorMessages?: string[] }>(
            response,
            'Jira error response',
            context?.signal
          )
          message = err?.message || err?.errorMessages?.[0] || message
        } catch (_e) {
          rethrowAttachmentDownloadError(_e, context?.signal)
        }
        throw new Error(message)
      }
      data = await readAttachmentJson<Record<string, unknown>>(
        response,
        'Jira issue',
        context?.signal
      )
      await fetchSupplementary(params.cloudId, data)
    }

    const issueData = transformIssueData(data)

    let files: Array<{ name: string; mimeType: string; data: Buffer; size: number }> | undefined
    if (params?.includeAttachments && issueData.attachments.length > 0) {
      files = await downloadJiraAttachments(issueData.attachments, params.accessToken, budget)
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        ...issueData,
        issue: data,
        ...(files && files.length > 0 ? { files } : {}),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    ...ISSUE_ITEM_PROPERTIES,
    issue: {
      type: 'json',
      description: 'Complete raw Jira issue object from the API',
      optional: true,
    },
    files: {
      type: 'file[]',
      description: 'Downloaded attachment files (only when includeAttachments is true)',
      optional: true,
    },
  },
}
