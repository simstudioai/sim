import type { JsmBaseParams } from '@/tools/jsm/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface JsmGetRequestAttachmentsParams extends JsmBaseParams {
  issueIdOrKey: string
  start?: number
  limit?: number
  includeAttachments?: boolean
}

/** Output properties for an attachment item */
const ATTACHMENT_ITEM_PROPERTIES = {
  filename: { type: 'string', description: 'Attachment filename' },
  author: {
    type: 'object',
    description: 'Author of the attachment',
    properties: {
      accountId: { type: 'string', description: 'Atlassian account ID' },
      displayName: { type: 'string', description: 'User display name' },
      active: { type: 'boolean', description: 'Whether the account is active' },
    },
  },
  created: {
    type: 'json',
    description: 'Creation date with iso8601, friendly, epochMillis',
  },
  size: { type: 'number', description: 'File size in bytes' },
  mimeType: { type: 'string', description: 'MIME type of the attachment' },
} as const

interface JsmGetRequestAttachmentsResponse extends ToolResponse {
  output: {
    ts: string
    issueIdOrKey: string
    attachments: Array<{
      filename: string
      author: { accountId: string; displayName: string; active: boolean } | null
      created: { iso8601: string; friendly: string; epochMillis: number } | null
      size: number
      mimeType: string
    }>
    total: number
    isLastPage: boolean
    files?: Array<{ name: string; mimeType: string; data: string; size: number }>
  }
}

export const jsmGetRequestAttachmentsTool: ToolConfig<
  JsmGetRequestAttachmentsParams,
  JsmGetRequestAttachmentsResponse
> = {
  id: 'jsm_get_request_attachments',
  name: 'JSM Get Request Attachments',
  description: 'Get attachments for a service request in Jira Service Management',
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
      description: 'OAuth access token for Jira Service Management',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Jira Cloud ID for the instance',
    },
    issueIdOrKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Issue ID or key (e.g., SD-123)',
    },
    includeAttachments: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Download attachment file contents and include them as files in the output',
    },
    start: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start index for pagination (e.g., 0, 50, 100)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results to return (e.g., 10, 25, 50)',
    },
  },

  request: {
    url: '/api/tools/jsm/attachments',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      issueIdOrKey: params.issueIdOrKey,
      includeAttachments: params.includeAttachments,
      start: params.start,
      limit: params.limit,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey: '',
          attachments: [],
          total: 0,
          isLastPage: true,
        },
        error: 'Empty response from API',
      }
    }

    const data = JSON.parse(responseText)

    if (data.success && data.output) {
      return data
    }

    return {
      success: data.success || false,
      output: data.output || {
        ts: new Date().toISOString(),
        issueIdOrKey: '',
        attachments: [],
        total: 0,
        isLastPage: true,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
    attachments: {
      type: 'array',
      description: 'List of attachments',
      items: {
        type: 'object',
        properties: ATTACHMENT_ITEM_PROPERTIES,
      },
    },
    total: { type: 'number', description: 'Total number of attachments' },
    isLastPage: { type: 'boolean', description: 'Whether this is the last page' },
    files: {
      type: 'file[]',
      description: 'Downloaded attachment files (only when includeAttachments is true)',
      optional: true,
    },
  },
}
