import type { ToolConfig } from '../types'
import type { MicrosoftTeamsReadResponse, MicrosoftTeamsToolParams } from './types'
import { extractMessageAttachments } from './utils'

export const readChatTool: ToolConfig<MicrosoftTeamsToolParams, MicrosoftTeamsReadResponse> = {
  id: 'microsoft_teams_read_chat',
  name: 'Read Microsoft Teams Chat',
  description: 'Read content from a Microsoft Teams chat',
  version: '1.1',
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
      visibility: 'user-only',
      description: 'The ID of the chat to read from',
    },
  },
  request: {
    url: (params) => {
      // Ensure chatId is valid
      const chatId = params.chatId?.trim()
      if (!chatId) {
        throw new Error('Chat ID is required')
      }
      // Fetch the most recent messages from the chat
      return `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages?$top=50&$orderby=createdDateTime desc`
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
  transformResponse: async (response: Response, params?: MicrosoftTeamsToolParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to read Microsoft Teams chat: ${errorText}`)
    }

    const data = await response.json()

    // Microsoft Graph API returns messages in a 'value' array
    const messages = data.value || []

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
          },
        },
      }
    }

    if (!params?.chatId) {
      throw new Error('Missing required parameter: chatId')
    }

    // Process messages with attachments
    const processedMessages = messages.map((message: any) => {
      const content = message.body?.content || 'No content'
      const messageId = message.id

      // Extract attachments without any content processing
      const attachments = extractMessageAttachments(message)

      return {
        id: messageId,
        content: content, // Keep original content without modification
        sender: message.from?.user?.displayName || 'Unknown',
        timestamp: message.createdDateTime,
        messageType: message.messageType || 'message',
        attachments, // Attachments only stored here
      }
    })

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
      chatId: messages[0]?.chatId || params.chatId || '',
      messageCount: messages.length,
      totalAttachments: allAttachments.length,
      attachmentTypes,
      messages: processedMessages,
    }

    return {
      success: true,
      output: {
        content: formattedMessages,
        metadata,
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
