import type { ToolConfig } from '../types'
import type { OutlookSendParams, OutlookSendResponse } from './types'

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
  },

  request: {
    url: (params) => {
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
      return {
        message: {
          subject: params.subject,
          body: {
            contentType: 'Text',
            content: params.body,
          },
          toRecipients: [
            {
              emailAddress: {
                address: params.to,
              },
            },
          ],
        },
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
