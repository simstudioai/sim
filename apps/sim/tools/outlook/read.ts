import type {
  CleanedOutlookMessage,
  OutlookAttachment,
  OutlookMessage,
  OutlookMessagesResponse,
  OutlookReadParams,
  OutlookReadResponse,
} from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Download attachments from an Outlook message
 */
async function downloadAttachments(
  messageId: string,
  accessToken: string
): Promise<OutlookAttachment[]> {
  const attachments: OutlookAttachment[] = []

  try {
    // Fetch attachments list from Microsoft Graph API
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      return attachments
    }

    const data = await response.json()
    const attachmentsList = data.value || []

    for (const attachment of attachmentsList) {
      try {
        // Microsoft Graph returns attachment data directly in the list response for file attachments
        if (attachment['@odata.type'] === '#microsoft.graph.fileAttachment') {
          const contentBytes = attachment.contentBytes
          if (contentBytes) {
            // contentBytes is base64 encoded
            const buffer = Buffer.from(contentBytes, 'base64')
            attachments.push({
              name: attachment.name,
              data: buffer,
              contentType: attachment.contentType,
              size: attachment.size,
            })
          }
        }
      } catch (error) {
        // Continue with other attachments
      }
    }
  } catch (error) {
    // Return empty array on error
  }

  return attachments
}

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
    includeAttachments: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Download and include email attachments',
    },
  },

  request: {
    url: (params) => {
      // Set max results (default to 1 for simplicity, max 10) with no negative values
      const maxResults = params.maxResults
        ? Math.max(1, Math.min(Math.abs(Number(params.maxResults)), 10))
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

  transformResponse: async (response: Response, params?: OutlookReadParams) => {
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
    const cleanedMessages: CleanedOutlookMessage[] = await Promise.all(
      messages.map(async (message: OutlookMessage) => {
        // Download attachments if requested
        let attachments: OutlookAttachment[] | undefined
        if (params?.includeAttachments && message.hasAttachments && params?.accessToken) {
          try {
            attachments = await downloadAttachments(message.id, params.accessToken)
          } catch (error) {
            // Continue without attachments rather than failing the entire request
          }
        }

        return {
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
          attachments: attachments || [],
          isRead: message.isRead,
          importance: message.importance,
        }
      })
    )

    // Flatten all attachments from all emails to top level for FileToolProcessor
    const allAttachments: OutlookAttachment[] = []
    for (const email of cleanedMessages) {
      if (email.attachments && email.attachments.length > 0) {
        allAttachments.push(...email.attachments)
      }
    }

    return {
      success: true,
      output: {
        message: `Successfully read ${cleanedMessages.length} email(s).`,
        results: cleanedMessages,
        attachments: allAttachments,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: { type: 'array', description: 'Array of email message objects' },
    attachments: { type: 'file[]', description: 'All email attachments flattened from all emails' },
  },
}
