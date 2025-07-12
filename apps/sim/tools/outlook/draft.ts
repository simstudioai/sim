import type { ToolConfig } from '../types'
import type { OutlookDraftParams, OutlookDraftResponse } from './types'

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
      return {
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
      }
    },
  },
  transformResponse: async (response) => {
    if (!response.ok) {
      let errorData
      try {
        errorData = await response.json()
      } catch {
        throw new Error('Failed to draft email')
      }
      throw new Error(errorData.error?.message || 'Failed to draft email')
    }

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
    return error.message || 'An unexpected error occurred while drafting email'
  },
}
