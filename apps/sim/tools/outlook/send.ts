import { ToolConfig } from '../types'
import { OutlookSendParams, OutlookSendResponse } from './types'


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
      description: 'Access token for Outlook API',
    },
    to: {
      type: 'string',
      required: true,
      description: 'Recipient email address',
    },
    subject: {
      type: 'string',
      required: true,
      description: 'Email subject',
    },
    body: {
      type: 'string',
      required: true,
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
    },
    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to send Outlook mail: ${errorText}`)
      }
  
      return {
        success: true,
        output: {
        message: 'Email sent successfully',
        results: [],
        },
      }
    },
    transformError: (error) => {
      // If it's an Error instance with a message, use that
      if (error instanceof Error) {
        return error.message
      }
  
      // If it's an object with an error or message property
      if (typeof error === 'object' && error !== null) {
        if (error.error) {
          return typeof error.error === 'string' ? error.error : JSON.stringify(error.error)
        }
        if (error.message) {
          return error.message
        }
      }
  
      // Default fallback message
      return 'An error occurred while reading Microsoft Teams chat'
    },
  }