import type {
  GmailAttachment,
  GmailMessage,
  GmailReadParams,
  GmailToolResponse,
} from '@/tools/gmail/types'
import type { ToolConfig } from '@/tools/types'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

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

  outputs: {
    content: { type: 'string', description: 'Text content of the email' },
    metadata: { type: 'json', description: 'Metadata of the email' },
    attachments: { type: 'file[]', description: 'Attachments of the email' },
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

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to read email')
    }

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

  transformError: (error) => {
    if (error.error?.message) {
      if (error.error.message.includes('invalid authentication credentials')) {
        return 'Invalid or expired access token. Please reauthenticate.'
      }
      if (error.error.message.includes('quota')) {
        return 'Gmail API quota exceeded. Please try again later.'
      }
      return error.error.message
    }
    return error.message || 'An unexpected error occurred while reading email'
  },
}

// Helper function to process a Gmail message
async function processMessage(
  message: GmailMessage,
  params?: GmailReadParams
): Promise<GmailToolResponse> {
  // Check if message and payload exist
  if (!message || !message.payload) {
    return {
      success: true,
      output: {
        content: 'Unable to process email: Invalid message format',
        metadata: {
          id: message?.id || '',
          threadId: message?.threadId || '',
          labelIds: message?.labelIds || [],
        },
      },
    }
  }

  const headers = message.payload.headers || []
  const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value || ''
  const from = headers.find((h) => h.name.toLowerCase() === 'from')?.value || ''
  const to = headers.find((h) => h.name.toLowerCase() === 'to')?.value || ''
  const date = headers.find((h) => h.name.toLowerCase() === 'date')?.value || ''

  // Extract the message body
  const body = extractMessageBody(message.payload)

  // Check for attachments
  const attachmentInfo = extractAttachmentInfo(message.payload)
  const hasAttachments = attachmentInfo.length > 0

  // Download attachments if requested
  let attachments: GmailAttachment[] | undefined
  if (params?.includeAttachments && hasAttachments && params.accessToken) {
    try {
      attachments = await downloadAttachments(message.id, attachmentInfo, params.accessToken)
    } catch (error) {
      // Continue without attachments rather than failing the entire request
    }
  }

  const result: GmailToolResponse = {
    success: true,
    output: {
      content: body || 'No content found in email',
      metadata: {
        id: message.id || '',
        threadId: message.threadId || '',
        labelIds: message.labelIds || [],
        from,
        to,
        subject,
        date,
        hasAttachments,
        attachmentCount: attachmentInfo.length,
      },
      // Always include attachments array (empty if none downloaded)
      attachments: attachments || [],
    },
  }

  return result
}

// Helper function to process a message for summary (without full content)
function processMessageForSummary(message: GmailMessage): any {
  if (!message || !message.payload) {
    return {
      id: message?.id || '',
      threadId: message?.threadId || '',
      subject: 'Unknown Subject',
      from: 'Unknown Sender',
      date: '',
      snippet: message?.snippet || '',
    }
  }

  const headers = message.payload.headers || []
  const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value || 'No Subject'
  const from = headers.find((h) => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender'
  const date = headers.find((h) => h.name.toLowerCase() === 'date')?.value || ''

  return {
    id: message.id,
    threadId: message.threadId,
    subject,
    from,
    date,
    snippet: message.snippet || '',
  }
}

// Helper function to create a summary of multiple messages
function createMessagesSummary(messages: any[]): string {
  if (messages.length === 0) {
    return 'No messages found.'
  }

  let summary = `Found ${messages.length} messages:\n\n`

  messages.forEach((msg, index) => {
    summary += `${index + 1}. Subject: ${msg.subject}\n`
    summary += `   From: ${msg.from}\n`
    summary += `   Date: ${msg.date}\n`
    summary += `   Preview: ${msg.snippet}\n\n`
  })

  summary += `To read a specific message, use the messageId parameter with one of these IDs: ${messages.map((m) => m.id).join(', ')}`

  return summary
}

// Helper function to recursively extract message body from MIME parts
function extractMessageBody(payload: any): string {
  // If the payload has a body with data, decode it
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString()
  }

  // If there are no parts, return empty string
  if (!payload.parts || !Array.isArray(payload.parts) || payload.parts.length === 0) {
    return ''
  }

  // First try to find a text/plain part
  const textPart = payload.parts.find((part: any) => part.mimeType === 'text/plain')
  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, 'base64').toString()
  }

  // If no text/plain, try to find text/html
  const htmlPart = payload.parts.find((part: any) => part.mimeType === 'text/html')
  if (htmlPart?.body?.data) {
    return Buffer.from(htmlPart.body.data, 'base64').toString()
  }

  // If we have multipart/alternative or other complex types, recursively check parts
  for (const part of payload.parts) {
    if (part.parts) {
      const nestedBody = extractMessageBody(part)
      if (nestedBody) {
        return nestedBody
      }
    }
  }

  // If we couldn't find any text content, return empty string
  return ''
}

// Helper function to extract attachment information from message payload
function extractAttachmentInfo(
  payload: any
): Array<{ attachmentId: string; filename: string; mimeType: string; size: number }> {
  const attachments: Array<{
    attachmentId: string
    filename: string
    mimeType: string
    size: number
  }> = []

  function processPayloadPart(part: any) {
    // Check if this part has an attachment
    if (part.body?.attachmentId && part.filename) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body.size || 0,
      })
    }

    // Recursively process nested parts
    if (part.parts && Array.isArray(part.parts)) {
      part.parts.forEach(processPayloadPart)
    }
  }

  // Process the main payload
  processPayloadPart(payload)

  return attachments
}

// Helper function to download attachments from Gmail API
async function downloadAttachments(
  messageId: string,
  attachmentInfo: Array<{ attachmentId: string; filename: string; mimeType: string; size: number }>,
  accessToken: string
): Promise<GmailAttachment[]> {
  const downloadedAttachments: GmailAttachment[] = []

  for (const attachment of attachmentInfo) {
    try {
      // Download attachment from Gmail API
      const attachmentResponse = await fetch(
        `${GMAIL_API_BASE}/messages/${messageId}/attachments/${attachment.attachmentId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!attachmentResponse.ok) {
        continue
      }

      const attachmentData = (await attachmentResponse.json()) as { data: string; size: number }

      // Decode base64url data to buffer
      // Gmail API returns data in base64url format (URL-safe base64)
      const base64Data = attachmentData.data.replace(/-/g, '+').replace(/_/g, '/')
      const buffer = Buffer.from(base64Data, 'base64')

      downloadedAttachments.push({
        name: attachment.filename,
        data: buffer,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })
    } catch (error) {
      // Continue with other attachments
    }
  }

  return downloadedAttachments
}
