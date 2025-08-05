import type { OutlookSendParams, OutlookSendResponse } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

export const outlookSendTool: ToolConfig<OutlookSendParams, OutlookSendResponse> = {
  id: 'outlook_send',
  name: 'Outlook Send',
  description: 'Send emails using Outlook',
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
      visibility: 'user-only',
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
    replyToMessageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message ID to reply to (for threading)',
    },
    conversationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversation ID for threading',
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
      // If replying to a specific message, use the reply endpoint
      if (params.replyToMessageId) {
        return `https://graph.microsoft.com/v1.0/me/messages/${params.replyToMessageId}/reply`
      }
      // Otherwise use the regular send mail endpoint
      return `https://graph.microsoft.com/v1.0/me/sendMail`
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
    body: (params: OutlookSendParams): Record<string, any> => {
      // Helper function to parse comma-separated emails
      const parseEmails = (emailString?: string) => {
        if (!emailString) return []
        return emailString
          .split(',')
          .map((email) => email.trim())
          .filter((email) => email.length > 0)
          .map((email) => ({ emailAddress: { address: email } }))
      }

      // If replying to a message, use the reply format
      if (params.replyToMessageId) {
        const replyBody: any = {
          message: {
            body: {
              contentType: 'Text',
              content: params.body,
            },
          },
        }

        // Add CC/BCC if provided
        const ccRecipients = parseEmails(params.cc)
        const bccRecipients = parseEmails(params.bcc)

        if (ccRecipients.length > 0) {
          replyBody.message.ccRecipients = ccRecipients
        }
        if (bccRecipients.length > 0) {
          replyBody.message.bccRecipients = bccRecipients
        }

        return replyBody
      }

      // Regular send mail format
      const toRecipients = parseEmails(params.to)
      const ccRecipients = parseEmails(params.cc)
      const bccRecipients = parseEmails(params.bcc)

      const message: any = {
        subject: params.subject,
        body: {
          contentType: 'Text',
          content: params.body,
        },
        toRecipients,
      }

      // Add CC/BCC if provided
      if (ccRecipients.length > 0) {
        message.ccRecipients = ccRecipients
      }
      if (bccRecipients.length > 0) {
        message.bccRecipients = bccRecipients
      }

      // Add conversation ID for threading if provided
      if (params.conversationId) {
        message.conversationId = params.conversationId
      }

      return {
        message,
        saveToSentItems: true,
      }
    },
  },
  transformResponse: async (response) => {
    if (!response.ok) {
      let errorData
      try {
        errorData = await response.json()
      } catch {
        throw new Error('Failed to send email')
      }
      throw new Error(errorData.error?.message || 'Failed to send email')
    }

    // Outlook sendMail API returns empty body on success
    return {
      success: true,
      output: {
        message: 'Email sent successfully',
        results: {
          status: 'sent',
          timestamp: new Date().toISOString(),
        },
      },
    }
  },

  transformError: (error) => {
    // Handle Outlook API error format
    if (error.error?.message) {
      if (error.error.message.includes('invalid authentication credentials')) {
        return 'Invalid or expired access token. Please reauthenticate.'
      }
      if (error.error.message.includes('quota')) {
        return 'Outlook API quota exceeded. Please try again later.'
      }
      return error.error.message
    }
    return error.message || 'An unexpected error occurred while sending email'
  },
}
