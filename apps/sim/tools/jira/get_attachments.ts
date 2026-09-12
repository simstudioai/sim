import { createSsrfGuardedFetchWithDispatcher } from '@/lib/core/security/input-validation.server'
import {
  AttachmentDownloadBudget,
  readAttachmentJson,
  rethrowAttachmentDownloadError,
} from '@/lib/uploads/utils/attachment-download-budget'
import type { JiraGetAttachmentsParams, JiraGetAttachmentsResponse } from '@/tools/jira/types'
import { ATTACHMENT_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { downloadJiraAttachments, getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig, ToolResponseContext } from '@/tools/types'

const { fetch: providerFetch } = createSsrfGuardedFetchWithDispatcher({
  profile: 'configuredEndpoint',
})

/**
 * Transforms a raw Jira attachment object into typed output.
 */
function transformAttachment(att: any) {
  return {
    id: att.id ?? '',
    filename: att.filename ?? '',
    mimeType: att.mimeType ?? '',
    size: att.size ?? 0,
    content: att.content ?? '',
    thumbnail: att.thumbnail ?? null,
    author: transformUser(att.author),
    authorName: att.author?.displayName ?? att.author?.accountId ?? 'Unknown',
    created:
      typeof att.created === 'number' ? new Date(att.created).toISOString() : (att.created ?? ''),
  }
}

export const jiraGetAttachmentsTool: ToolConfig<
  JiraGetAttachmentsParams,
  JiraGetAttachmentsResponse
> = {
  id: 'jira_get_attachments',
  name: 'Jira Get Attachments',
  description: 'Get all attachments from a Jira issue',
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
      description: 'Jira issue key to get attachments from (e.g., PROJ-123)',
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
    url: (params: JiraGetAttachmentsParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey?.trim() ?? ''}?fields=attachment`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetAttachmentsParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (
    response: Response,
    params?: JiraGetAttachmentsParams,
    context?: ToolResponseContext
  ) => {
    const budget = new AttachmentDownloadBudget(context)
    context?.signal?.throwIfAborted()
    const fetchAttachments = async (cloudId: string) => {
      const attachmentsUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params!.issueKey?.trim() ?? ''}?fields=attachment`
      const attachmentsResponse = await providerFetch(attachmentsUrl, {
        method: 'GET',
        signal: context?.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })

      if (!attachmentsResponse.ok) {
        let message = `Failed to get attachments from Jira issue (${attachmentsResponse.status})`
        try {
          const err = await readAttachmentJson<{ message?: string; errorMessages?: string[] }>(
            attachmentsResponse,
            'Jira error response',
            context?.signal
          )
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {
          rethrowAttachmentDownloadError(_e, context?.signal)
        }
        throw new Error(message)
      }

      return readAttachmentJson<Record<string, unknown>>(
        attachmentsResponse,
        'Jira attachment metadata',
        context?.signal
      )
    }

    let data: any

    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken, {
        signal: context?.signal,
      })
      data = await fetchAttachments(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get attachments from Jira issue (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {
          rethrowAttachmentDownloadError(_e, context?.signal)
        }
        throw new Error(message)
      }
      data = await response.json()
    }

    const attachments = (data?.fields?.attachment ?? []).map(transformAttachment)

    let files: Array<{ name: string; mimeType: string; data: Buffer; size: number }> | undefined
    if (params?.includeAttachments && attachments.length > 0) {
      files = await downloadJiraAttachments(attachments, params.accessToken, budget)
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: params?.issueKey ?? 'unknown',
        attachments,
        ...(files && files.length > 0 ? { files } : {}),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    issueKey: { type: 'string', description: 'Issue key' },
    attachments: {
      type: 'array',
      description: 'Array of attachments',
      items: {
        type: 'object',
        properties: ATTACHMENT_ITEM_PROPERTIES,
      },
    },
    files: {
      type: 'file[]',
      description: 'Downloaded attachment files (only when includeAttachments is true)',
      optional: true,
    },
  },
}
