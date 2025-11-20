import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface JiraDeleteAttachmentParams {
  accessToken: string
  domain: string
  attachmentId: string
  cloudId?: string
}

export interface JiraDeleteAttachmentResponse extends ToolResponse {
  output: {
    ts: string
    attachmentId: string
    success: boolean
  }
}

export const jiraDeleteAttachmentTool: ToolConfig<
  JiraDeleteAttachmentParams,
  JiraDeleteAttachmentResponse
> = {
  id: 'jira_delete_attachment',
  name: 'Jira Delete Attachment',
  description: 'Delete an attachment from a Jira issue',
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
    attachmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the attachment to delete',
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
    url: (params: JiraDeleteAttachmentParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/attachment/${params.attachmentId}`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: (params: JiraDeleteAttachmentParams) => (params.cloudId ? 'DELETE' : 'GET'),
    headers: (params: JiraDeleteAttachmentParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params?: JiraDeleteAttachmentParams) => {
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      // Make the actual request with the resolved cloudId
      const attachmentUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/attachment/${params?.attachmentId}`
      const attachmentResponse = await fetch(attachmentUrl, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params?.accessToken}`,
        },
      })

      if (!attachmentResponse.ok) {
        let message = `Failed to delete attachment from Jira issue (${attachmentResponse.status})`
        try {
          const err = await attachmentResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          attachmentId: params?.attachmentId || 'unknown',
          success: true,
        },
      }
    }

    // If cloudId was provided, process the response
    if (!response.ok) {
      let message = `Failed to delete attachment from Jira issue (${response.status})`
      try {
        const err = await response.json()
        message = err?.errorMessages?.join(', ') || err?.message || message
      } catch (_e) {}
      throw new Error(message)
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        attachmentId: params?.attachmentId || 'unknown',
        success: true,
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
      description: 'Deletion details with timestamp, attachment ID, and success status',
    },
  },
}
