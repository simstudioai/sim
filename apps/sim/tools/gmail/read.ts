import { createLogger } from '@sim/logger'
import type { GmailAttachment, GmailReadParams, GmailToolResponse } from '@/tools/gmail/types'
import {
  createMessagesSummary,
  GMAIL_API_BASE,
  processMessage,
  processMessageForSummary,
} from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GmailReadTool')

export const gmailReadTool: ToolConfig<GmailReadParams, GmailToolResponse> = {
  id: 'gmail_read',
  name: 'Gmail Read',
  description: 'Read emails from Gmail',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-email',
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
      visibility: 'user-or-llm',
      description: 'Gmail message ID to read (e.g., 18f1a2b3c4d5e6f7)',
    },
    folder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Folder/label to read emails from (e.g., INBOX, SENT, DRAFT, TRASH, SPAM, or custom label name)',
    },
    unreadOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to true to only retrieve unread messages',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of messages to retrieve (default: 1, max: 10)',
    },
    includeAttachments: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to true to download and include email attachments',
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
      const maxResults = params.maxResults ? Math.min(Number(params.maxResults), 10) : 1
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
      const maxResults = params?.maxResults ? Math.min(Number(params.maxResults), 10) : 1

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

          // Create summary from processed messages first
          const summaryMessages = messages.map(processMessageForSummary)

          const allAttachments: GmailAttachment[] = []
          if (params?.includeAttachments) {
            for (const msg of messages) {
              try {
                const processedResult = await processMessage(msg, params)
                if (
                  processedResult.output.attachments &&
                  processedResult.output.attachments.length > 0
                ) {
                  allAttachments.push(...processedResult.output.attachments)
                }
              } catch (error: any) {
                logger.error(`Error processing message ${msg.id} for attachments:`, error)
              }
            }
          }

          return {
            success: true,
            output: {
              content: createMessagesSummary(summaryMessages),
              metadata: {
                results: summaryMessages.map((msg) => ({
                  id: msg.id,
                  threadId: msg.threadId,
                  subject: msg.subject,
                  from: msg.from,
                  to: msg.to,
                  date: msg.date,
                })),
              },
              attachments: allAttachments,
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
              attachments: [],
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

interface GmailReadV2Response {
  success: boolean
  output: {
    id?: string
    threadId?: string
    labelIds?: string[]
    from?: string
    to?: string
    subject?: string
    date?: string
    body?: string
    hasAttachments?: boolean
    attachmentCount?: number
    attachments?: GmailAttachment[]
    results?: Array<Record<string, any>>
  }
}

export const gmailReadV2Tool: ToolConfig<GmailReadParams, GmailReadV2Response> = {
  id: 'gmail_read_v2',
  name: 'Gmail Read',
  description: 'Read emails from Gmail. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: gmailReadTool.oauth,
  params: gmailReadTool.params,
  request: gmailReadTool.request,
  transformResponse: async (response: Response, params?: GmailReadParams) => {
    const legacy = await gmailReadTool.transformResponse!(response, params)
    if (!legacy.success) {
      return {
        success: false,
        output: {},
        error: legacy.error,
      }
    }

    const metadata = (legacy.output.metadata || {}) as any

    return {
      success: true,
      output: {
        id: metadata.id,
        threadId: metadata.threadId,
        labelIds: metadata.labelIds,
        from: metadata.from,
        to: metadata.to,
        subject: metadata.subject,
        date: metadata.date,
        body: legacy.output.content,
        hasAttachments: metadata.hasAttachments,
        attachmentCount: metadata.attachmentCount,
        attachments: legacy.output.attachments || [],
        results: metadata.results,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Gmail message ID', optional: true },
    threadId: { type: 'string', description: 'Gmail thread ID', optional: true },
    labelIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'Email labels',
      optional: true,
    },
    from: { type: 'string', description: 'Sender email address', optional: true },
    to: { type: 'string', description: 'Recipient email address', optional: true },
    subject: { type: 'string', description: 'Email subject', optional: true },
    date: { type: 'string', description: 'Email date', optional: true },
    body: {
      type: 'string',
      description: 'Email body text (best-effort plain text)',
      optional: true,
    },
    hasAttachments: {
      type: 'boolean',
      description: 'Whether the email has attachments',
      optional: true,
    },
    attachmentCount: { type: 'number', description: 'Number of attachments', optional: true },
    attachments: {
      type: 'file[]',
      description: 'Downloaded attachments (if enabled)',
      optional: true,
    },
    results: {
      type: 'json',
      description: 'Summary results when reading multiple messages',
      optional: true,
    },
  },
}
