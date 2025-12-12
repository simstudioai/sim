import type { JiraGetAttachmentsParams, JiraGetAttachmentsResponse } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

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
      visibility: 'user-only',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    issueKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Jira issue key to get attachments from (e.g., PROJ-123)',
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
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}?fields=attachment`
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

  transformResponse: async (response: Response, params?: JiraGetAttachmentsParams) => {
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      // Make the actual request with the resolved cloudId
      const attachmentsUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params?.issueKey}?fields=attachment`
      const attachmentsResponse = await fetch(attachmentsUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params?.accessToken}`,
        },
      })

      if (!attachmentsResponse.ok) {
        let message = `Failed to get attachments from Jira issue (${attachmentsResponse.status})`
        try {
          const err = await attachmentsResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      const data = await attachmentsResponse.json()

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: params?.issueKey || 'unknown',
          attachments: (data?.fields?.attachment || []).map((att: any) => ({
            id: att.id,
            filename: att.filename,
            size: att.size,
            mimeType: att.mimeType,
            created: att.created,
            author: att.author?.displayName || att.author?.accountId || 'Unknown',
          })),
        },
      }
    }

    // If cloudId was provided, process the response
    if (!response.ok) {
      let message = `Failed to get attachments from Jira issue (${response.status})`
      try {
        const err = await response.json()
        message = err?.errorMessages?.join(', ') || err?.message || message
      } catch (_e) {}
      throw new Error(message)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: params?.issueKey || 'unknown',
        attachments: (data?.fields?.attachment || []).map((att: any) => ({
          id: att.id,
          filename: att.filename,
          size: att.size,
          mimeType: att.mimeType,
          created: att.created,
          author: att.author?.displayName || att.author?.accountId || 'Unknown',
        })),
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
      description: 'Attachments data with timestamp, issue key, and array of attachments',
    },
  },
}
