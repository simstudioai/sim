import type { ToolConfig } from '../types'
import type {
  CleanedOutlookMessage,
  OutlookMessage,
  OutlookMessagesResponse,
  OutlookReadParams,
  OutlookReadResponse,
} from './types'

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
      visibility: 'hidden',
      description: 'OAuth access token for Outlook',
    },
    folder: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Folder ID to read emails from (default: Inbox)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of emails to retrieve (default: 1, max: 10)',
    },
  },
  request: {
    url: (params) => {
      // Set max results (default to 1 for simplicity, max 10) with no negative values
      const maxResults = params.maxResults
        ? Math.max(1, Math.min(Math.abs(params.maxResults), 10))
        : 1

      // If folder is provided, read from that specific folder
      if (params.folder) {
        return `https://graph.microsoft.com/v1.0/me/mailFolders/${params.folder}/messages?$top=${maxResults}&$orderby=createdDateTime desc`
      }

      // Otherwise fetch from all messages (default behavior)
      return `https://graph.microsoft.com/v1.0/me/messages?$top=${maxResults}&$orderby=createdDateTime desc`
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

    const data: OutlookMessagesResponse = await response.json()

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

    // Clean up the message data to only include essential fields
    const cleanedMessages: CleanedOutlookMessage[] = messages.map((message: OutlookMessage) => ({
      id: message.id,
      subject: message.subject,
      bodyPreview: message.bodyPreview,
      body: {
        contentType: message.body?.contentType,
        content: message.body?.content,
      },
      sender: {
        name: message.sender?.emailAddress?.name,
        address: message.sender?.emailAddress?.address,
      },
      from: {
        name: message.from?.emailAddress?.name,
        address: message.from?.emailAddress?.address,
      },
      toRecipients:
        message.toRecipients?.map((recipient) => ({
          name: recipient.emailAddress?.name,
          address: recipient.emailAddress?.address,
        })) || [],
      ccRecipients:
        message.ccRecipients?.map((recipient) => ({
          name: recipient.emailAddress?.name,
          address: recipient.emailAddress?.address,
        })) || [],
      receivedDateTime: message.receivedDateTime,
      sentDateTime: message.sentDateTime,
      hasAttachments: message.hasAttachments,
      isRead: message.isRead,
      importance: message.importance,
    }))

    return {
      success: true,
      output: {
        message: `Successfully read ${cleanedMessages.length} email(s).`,
        results: cleanedMessages,
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
    return 'An error occurred while reading Outlook email'
  },
}
