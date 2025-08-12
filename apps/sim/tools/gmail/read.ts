import type { GmailReadParams, GmailToolResponse } from '@/tools/gmail/types'
import {
  createMessagesSummary,
  GMAIL_API_BASE,
  processMessage,
  processMessageForSummary,
} from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'

export const gmailReadTool: ToolConfig<GmailReadParams, GmailToolResponse> = {
  id: 'gmail_read',
  name: 'Gmail Read',
  description: 'Read emails from Gmail',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-email',
    additionalScopes: [
      'https://www.googleapis.com/auth/gmail.labels',
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Gmail API',
    },
    messageId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the message to read',
    },
    folder: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Folder/label to read emails from',
    },
    unreadOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Only retrieve unread messages',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of messages to retrieve (default: 1, max: 10)',
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
      // If a specific message ID is provided, fetch that message directly with full format
      if (params.messageId) {
        return `${GMAIL_API_BASE}/messages/${params.messageId}?format=full`
      }

      // Otherwise, list messages from the specified folder or INBOX by default
      const url = new URL(`${GMAIL_API_BASE}/messages`)

      // Build query parameters for the folder/label
      const queryParams = []

      // Add unread filter if specified
      if (params.unreadOnly) {
        queryParams.push('is:unread')
      }

      if (params.folder) {
        // If it's a system label like INBOX, SENT, etc., use it directly
        if (['INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM'].includes(params.folder)) {
          queryParams.push(`in:${params.folder.toLowerCase()}`)
        } else {
          // Otherwise, it's a user-defined label
          queryParams.push(`label:${params.folder}`)
        }
      } else {
        // Default to INBOX if no folder is specified
        queryParams.push('in:inbox')
      }

      // Only add query if we have parameters
      if (queryParams.length > 0) {
        url.searchParams.append('q', queryParams.join(' '))
      }

      // Set max results (default to 1 for simplicity, max 10)
      const maxResults = params.maxResults ? Math.min(params.maxResults, 10) : 1
      url.searchParams.append('maxResults', maxResults.toString())

      return url.toString()
    },
    method: 'GET',
    headers: (params: GmailReadParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params?: GmailReadParams) => {
    const data = await response.json()

    // If we're fetching a single message directly (by ID)
    if (params?.messageId) {
      return await processMessage(data, params)
    }

    // If we're listing messages, we need to fetch each message's details
    if (data.messages && Array.isArray(data.messages)) {
      // Return a message if no emails found
      if (data.messages.length === 0) {
        return {
          success: true,
          output: {
            content: 'No messages found in the selected folder.',
            metadata: {
              results: [], // Use SearchMetadata format
            },
          },
        }
      }

      // For agentic workflows, we'll fetch the first message by default
      // If maxResults > 1, we'll return a summary of messages found
      const maxResults = params?.maxResults ? Math.min(params.maxResults, 10) : 1

      if (maxResults === 1) {
        try {
          // Get the first message details
          const messageId = data.messages[0].id
          const messageResponse = await fetch(
            `${GMAIL_API_BASE}/messages/${messageId}?format=full`,
            {
              headers: {
                Authorization: `Bearer ${params?.accessToken || ''}`,
                'Content-Type': 'application/json',
              },
            }
          )

          if (!messageResponse.ok) {
            const errorData = await messageResponse.json()
            throw new Error(errorData.error?.message || 'Failed to fetch message details')
          }

          const message = await messageResponse.json()
          return await processMessage(message, params)
        } catch (error: any) {
          return {
            success: true,
            output: {
              content: `Found messages but couldn't retrieve details: ${error.message || 'Unknown error'}`,
              metadata: {
                results: data.messages.map((msg: any) => ({
                  id: msg.id,
                  threadId: msg.threadId,
                })),
              },
            },
          }
        }
      } else {
        // If maxResults > 1, fetch details for all messages
        try {
          const messagePromises = data.messages.slice(0, maxResults).map(async (msg: any) => {
            const messageResponse = await fetch(
              `${GMAIL_API_BASE}/messages/${msg.id}?format=full`,
              {
                headers: {
                  Authorization: `Bearer ${params?.accessToken || ''}`,
                  'Content-Type': 'application/json',
                },
              }
            )

            if (!messageResponse.ok) {
              throw new Error(`Failed to fetch details for message ${msg.id}`)
            }

            return await messageResponse.json()
          })

          const messages = await Promise.all(messagePromises)

          // Process all messages and create a summary
          const processedMessages = messages.map(processMessageForSummary)

          return {
            success: true,
            output: {
              content: createMessagesSummary(processedMessages),
              metadata: {
                results: processedMessages.map((msg) => ({
                  id: msg.id,
                  threadId: msg.threadId,
                  subject: msg.subject,
                  from: msg.from,
                  date: msg.date,
                })),
              },
            },
          }
        } catch (error: any) {
          return {
            success: true,
            output: {
              content: `Found ${data.messages.length} messages but couldn't retrieve all details: ${error.message || 'Unknown error'}`,
              metadata: {
                results: data.messages.map((msg: any) => ({
                  id: msg.id,
                  threadId: msg.threadId,
                })),
              },
            },
          }
        }
      }
    }

    // Fallback for unexpected response format
    return {
      success: true,
      output: {
        content: 'Unexpected response format from Gmail API',
        metadata: {
          results: [],
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Text content of the email' },
    metadata: { type: 'json', description: 'Metadata of the email' },
    attachments: { type: 'file[]', description: 'Attachments of the email' },
  },
}
