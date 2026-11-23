import {
  AttachmentDownloadBudget,
  rethrowAttachmentDownloadError,
} from '@/lib/uploads/utils/attachment-download-budget'
import type {
  MicrosoftTeamsReadResponse,
  MicrosoftTeamsToolParams,
} from '@/tools/microsoft_teams/types'
import {
  downloadAllReferenceAttachments,
  extractMessageAttachments,
  extractMessageDetails,
  extractNextPageToken,
  fetchHostedContentsForChatMessage,
  resolvePageSize,
} from '@/tools/microsoft_teams/utils'
import type { ToolConfig, ToolFileData, ToolResponseContext } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const readChatTool: ToolConfig<MicrosoftTeamsToolParams, MicrosoftTeamsReadResponse> = {
  id: 'microsoft_teams_read_chat',
  name: 'Read Microsoft Teams Chat',
  description: 'Read content from a Microsoft Teams chat',
  version: '1.0',
  errorExtractor: 'nested-error-object',

  oauth: {
    required: true,
    provider: 'microsoft-teams',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Microsoft Teams API',
    },
    chatId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the chat to read from (e.g., "19:abc123def456@thread.v2" - from chat listings)',
    },
    includeAttachments: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Download and include message attachments (hosted contents) into storage',
    },
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of messages to return per page (1-50, default 50)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous read (nextPageToken) to fetch older messages',
    },
  },

  request: {
    url: (params) => {
      const chatId = safeUrlPathSegment(params.chatId ?? '', 'Chat ID')
      const pageToken = params.pageToken?.trim()
      const skipToken = pageToken ? `&$skiptoken=${encodeURIComponent(pageToken)}` : ''
      return `https://graph.microsoft.com/v1.0/chats/${chatId}/messages?$top=${resolvePageSize(params.top)}&$orderby=createdDateTime desc${skipToken}`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (
    response: Response,
    params?: MicrosoftTeamsToolParams,
    context?: ToolResponseContext
  ) => {
    const budget = new AttachmentDownloadBudget(context)
    context?.signal?.throwIfAborted()
    const data = await response.json()

    const messages = data.value || []
    const nextPageToken = extractNextPageToken(data['@odata.nextLink'])
    const hasMore = Boolean(data['@odata.nextLink'])

    if (messages.length === 0) {
      return {
        success: true,
        output: {
          content: 'No messages found in this chat.',
          metadata: {
            chatId: '',
            messageCount: 0,
            messages: [],
            totalAttachments: 0,
            attachmentTypes: [],
            hasMore,
            nextPageToken,
          },
          messages: [],
          messageCount: 0,
          chatId: params?.chatId ?? '',
          attachmentCount: 0,
          attachmentTypes: [],
          hasMore,
          nextPageToken,
        },
      }
    }

    const processedMessages: NonNullable<
      MicrosoftTeamsReadResponse['output']['metadata']['messages']
    > = []
    for (const message of messages) {
      context?.signal?.throwIfAborted()
      const content = message.body?.content || 'No content'
      const messageId = message.id

      const attachments = extractMessageAttachments(message)

      let uploaded: ToolFileData[] = []
      if (params?.includeAttachments && params.accessToken && params.chatId && messageId) {
        try {
          const hostedContents = await fetchHostedContentsForChatMessage({
            accessToken: params.accessToken,
            chatId: params.chatId,
            messageId,
            budget,
          })
          uploaded.push(...hostedContents)

          const referenceFiles = await downloadAllReferenceAttachments({
            accessToken: params.accessToken,
            attachments,
            budget,
          })
          uploaded.push(...referenceFiles)
        } catch (_e) {
          rethrowAttachmentDownloadError(_e, context?.signal)
          uploaded = []
        }
      }

      processedMessages.push({
        ...extractMessageDetails(message),
        id: messageId,
        content: content, // Keep original content without modification
        sender: message.from?.user?.displayName || 'Unknown',
        timestamp: message.createdDateTime,
        messageType: message.messageType || 'message',
        attachments, // Raw attachment metadata
        uploadedFiles: uploaded, // Uploaded file infos (paths/keys)
      })
    }

    // Format the messages into a readable text (no attachment info in content)
    const formattedMessages = processedMessages
      .map((message: any) => {
        const sender = message.sender
        const timestamp = message.timestamp
          ? new Date(message.timestamp).toLocaleString()
          : 'Unknown time'

        return `[${timestamp}] ${sender}: ${message.content}`
      })
      .join('\n\n')

    // Calculate attachment statistics
    const allAttachments = processedMessages.flatMap((msg: any) => msg.attachments || [])
    const attachmentTypes: string[] = []
    const seenTypes = new Set<string>()

    allAttachments.forEach((att: any) => {
      if (
        att.contentType &&
        typeof att.contentType === 'string' &&
        !seenTypes.has(att.contentType)
      ) {
        attachmentTypes.push(att.contentType)
        seenTypes.add(att.contentType)
      }
    })

    // Create document metadata
    const metadata = {
      chatId: messages[0]?.chatId || params?.chatId || '',
      messageCount: messages.length,
      totalAttachments: allAttachments.length,
      attachmentTypes,
      messages: processedMessages,
      hasMore,
      nextPageToken,
    }

    // Flatten uploaded files across all messages for convenience
    const flattenedUploads = processedMessages.flatMap((m: any) => m.uploadedFiles || [])

    return {
      success: true,
      output: {
        content: formattedMessages,
        metadata,
        attachments: flattenedUploads,
        messages: metadata.messages,
        messageCount: metadata.messageCount,
        chatId: metadata.chatId,
        attachmentCount: metadata.totalAttachments,
        attachmentTypes,
        hasMore,
        nextPageToken,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Teams chat read operation success status' },
    messageCount: { type: 'number', description: 'Number of messages retrieved from chat' },
    chatId: { type: 'string', description: 'ID of the chat that was read from' },
    messages: {
      type: 'array',
      description:
        'Array of chat message objects (also available at metadata.messages). Each has id, content, sender, timestamp, messageType, attachments, from (user/application/device), senderId, senderType, replyToId, subject, importance, webUrl, contentType, lastModifiedDateTime, lastEditedDateTime, deletedDateTime, mentions, and reactions',
    },
    attachmentCount: { type: 'number', description: 'Total number of attachments found' },
    attachmentTypes: { type: 'array', description: 'Types of attachments found' },
    content: { type: 'string', description: 'Formatted content of chat messages' },
    hasMore: {
      type: 'boolean',
      description: 'Whether Graph indicated more messages beyond this page',
      optional: true,
    },
    nextPageToken: {
      type: 'string',
      description: 'Token to pass as pageToken to fetch the next page, or null on the last page',
      optional: true,
    },
    attachments: {
      type: 'file[]',
      description: 'Uploaded attachments for convenience (flattened)',
    },
  },
}
