import { ToolConfig } from '../types'
import { OutlookReadParams, OutlookReadResponse } from './types'

export const outlookReadTool: ToolConfig<OutlookReadParams, OutlookReadResponse> = {
  id: 'outlook_read',
  name: 'Outlook Read',
  description: 'Read emails from Outlook',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'outlook',
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'OAuth access token for Outlook',
    },
    messageId: {
        type: 'string',
        required: false,
        description: 'Message ID to read',
    }
  },
  request: {
    url: (params) => {
        // If messageId is provided, fetch that specific message
        if (params.messageId) {
            return `https://graph.microsoft.com/v1.0/me/messages/${params.messageId}`
        }
        // Otherwise fetch the most recent messages
        return `https://graph.microsoft.com/v1.0/me/messages?$top=50&$orderby=createdDateTime desc`
    },
      method: 'GET',
      headers: (params) => {
        // Validate access token
        if (!params.accessToken) {
          throw new Error('Access token is required')
        }
  
        return {
          Authorization: `Bearer ${params.accessToken}`,
        }
      },
    },
    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to read Outlook mail: ${errorText}`)
      }
  
      const data = await response.json()
  
      // Microsoft Graph API returns messages in a 'value' array
      const messages = data.value || []
  
      if (messages.length === 0) {
        return {
          success: true,
          output: {
            message: 'No mail found.',
            results: [],
          },
        }
      }     
  
      return {
        success: true,
        output: {
          message: 'Email read successfully',
          results: messages,
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