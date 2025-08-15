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
  },

  request: {
    url: (params) => {
      return `https://graph.microsoft.com/v1.0/me/messages`
    },
    method: 'POST',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params: OutlookDraftParams): Record<string, any> => {
      // Helper function to parse comma-separated emails
      const parseEmails = (emailString?: string) => {
        if (!emailString) return []
        return emailString
          .split(',')
          .map((email) => email.trim())
          .filter((email) => email.length > 0)
          .map((email) => ({ emailAddress: { address: email } }))
      }

      const message: any = {
        subject: params.subject,
        body: {
          contentType: 'Text',
          content: params.body,
        },
        toRecipients: parseEmails(params.to),
      }

      // Add CC if provided
      const ccRecipients = parseEmails(params.cc)
      if (ccRecipients.length > 0) {
        message.ccRecipients = ccRecipients
      }

      // Add BCC if provided
      const bccRecipients = parseEmails(params.bcc)
      if (bccRecipients.length > 0) {
        message.bccRecipients = bccRecipients
      }

      return message
    },
  },
  transformResponse: async (response) => {
    // Outlook draft API returns the created message object
    const data = await response.json()

    return {
      success: true,
      output: {
        message: 'Email drafted successfully',
        results: {
          id: data.id,
          subject: data.subject,
          status: 'drafted',
          timestamp: new Date().toISOString(),
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
