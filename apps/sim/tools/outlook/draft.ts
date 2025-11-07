import type { OutlookDraftParams, OutlookDraftResponse } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

export const outlookDraftTool: ToolConfig<OutlookDraftParams, OutlookDraftResponse> = {
  id: 'outlook_draft',
  name: 'Outlook Draft',
  description: 'Draft emails using Outlook',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'outlook',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Outlook API',
    },
    to: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient email address',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email subject',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email body content',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content type for the email body (text or html)',
    },
    cc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CC recipients (comma-separated)',
    },
    bcc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'BCC recipients (comma-separated)',
    },
    attachments: {
      type: 'file[]',
      required: false,
      visibility: 'user-only',
      description: 'Files to attach to the email draft',
    },
  },

  request: {
    url: '/api/tools/outlook/draft',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: OutlookDraftParams) => {
      return {
        accessToken: params.accessToken,
        to: params.to,
        subject: params.subject,
        body: params.body,
        contentType: params.contentType || 'text',
        cc: params.cc || null,
        bcc: params.bcc || null,
        attachments: params.attachments || null,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to create Outlook draft')
    }
    return {
      success: true,
      output: {
        message: data.output.message,
        results: {
          id: data.output.messageId,
          subject: data.output.subject,
          status: 'drafted',
          timestamp: new Date().toISOString(),
          attachmentCount: data.output.attachmentCount || 0,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Email draft creation success status' },
    messageId: { type: 'string', description: 'Unique identifier for the drafted email' },
    status: { type: 'string', description: 'Draft status of the email' },
    subject: { type: 'string', description: 'Subject of the drafted email' },
    timestamp: { type: 'string', description: 'Timestamp when draft was created' },
    message: { type: 'string', description: 'Success or error message' },
  },
}
