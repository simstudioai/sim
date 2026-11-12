import type {
  MicrosoftTeamsGetMessageParams,
  MicrosoftTeamsReadResponse,
} from '@/tools/microsoft_teams/types'
import { extractMessageDetails } from '@/tools/microsoft_teams/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getMessageTool: ToolConfig<
  MicrosoftTeamsGetMessageParams,
  MicrosoftTeamsReadResponse
> = {
  id: 'microsoft_teams_get_message',
  name: 'Get Microsoft Teams Message',
  description: 'Get a specific message from a Microsoft Teams chat or channel',
  version: '1.0',
  assistant: { effect: 'read', version: 1 },
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
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the team for channel messages (e.g., "12345678-abcd-1234-efgh-123456789012" - a GUID)',
    },
    channelId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the channel for channel messages (e.g., "19:abc123def456@thread.tacv2")',
    },
    chatId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The ID of the chat for chat messages (e.g., "19:abc123def456@thread.v2")',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the message to retrieve (e.g., "1234567890123" - a numeric string from message responses)',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the retrieval was successful' },
    content: { type: 'string', description: 'The message content' },
    metadata: {
      type: 'object',
      description: 'Message metadata including sender, timestamp, etc.',
      properties: {
        messageId: { type: 'string', description: 'Message ID' },
        content: { type: 'string', description: 'Message content' },
        createdTime: { type: 'string', description: 'Message creation timestamp' },
        url: { type: 'string', description: 'Web URL to the message' },
        teamId: { type: 'string', description: 'Team ID' },
        channelId: { type: 'string', description: 'Channel ID' },
        chatId: { type: 'string', description: 'Chat ID' },
        messages: { type: 'array', description: 'Array of message details' },
        messageCount: { type: 'number', description: 'Number of messages' },
      },
    },
    messageId: { type: 'string', description: 'Message ID', optional: true },
    sender: { type: 'string', description: 'Sender display name', optional: true },
    messageType: { type: 'string', description: 'Graph message type', optional: true },
    createdTime: { type: 'string', description: 'Message creation timestamp', optional: true },
    url: { type: 'string', description: 'Web URL to the message', optional: true },
    from: {
      type: 'json',
      description:
        'Sender identity set: user, application (bot), or device, each with id and displayName',
      optional: true,
    },
    senderId: {
      type: 'string',
      description: 'ID of the sending user or application',
      optional: true,
    },
    senderType: {
      type: 'string',
      description: 'Sender kind: user, application, or device',
      optional: true,
    },
    replyToId: {
      type: 'string',
      description: 'ID of the parent message for channel replies',
      optional: true,
    },
    subject: { type: 'string', description: 'Message subject', optional: true },
    summary: { type: 'string', description: 'Message summary (channel messages)', optional: true },
    importance: { type: 'string', description: 'normal, high, or urgent', optional: true },
    webUrl: { type: 'string', description: 'Link to the message in Teams', optional: true },
    contentType: { type: 'string', description: 'Body content type: text or html', optional: true },
    lastModifiedDateTime: {
      type: 'string',
      description: 'When the message or its reactions last changed',
      optional: true,
    },
    lastEditedDateTime: {
      type: 'string',
      description: 'When the message was last edited',
      optional: true,
    },
    deletedDateTime: {
      type: 'string',
      description: 'When the message was deleted',
      optional: true,
    },
    mentions: {
      type: 'array',
      description: 'Entities mentioned in the message (id, mentionText, mentioned)',
      optional: true,
    },
    reactions: {
      type: 'array',
      description:
        'Reactions (reactionType, displayName, createdDateTime, userId, userDisplayName)',
      optional: true,
    },
  },

  request: {
    url: (params) => {
      const messageId = safeUrlPathSegment(params.messageId ?? '', 'Message ID')

      if (params.teamId && params.channelId) {
        const teamId = safeUrlPathSegment(params.teamId, 'Team ID')
        const channelId = safeUrlPathSegment(params.channelId, 'Channel ID')
        return `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages/${messageId}`
      }
      if (params.chatId) {
        const chatId = safeUrlPathSegment(params.chatId, 'Chat ID')
        return `https://graph.microsoft.com/v1.0/chats/${chatId}/messages/${messageId}`
      }

      throw new Error('Either (teamId and channelId) or chatId is required')
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

  transformResponse: async (response: Response, params?: MicrosoftTeamsGetMessageParams) => {
    const data = await response.json()
    const details = extractMessageDetails(data)

    const metadata = {
      messageId: data.id || params?.messageId || '',
      content: data.body?.content || '',
      createdTime: data.createdDateTime || '',
      url: data.webUrl || '',
      teamId: params?.teamId,
      channelId: params?.channelId,
      chatId: params?.chatId,
      messages: [
        {
          ...details,
          id: data.id || '',
          content: data.body?.content || '',
          sender: data.from?.user?.displayName || 'Unknown',
          timestamp: data.createdDateTime || '',
          messageType: data.messageType || 'message',
          attachments: data.attachments || [],
        },
      ],
      messageCount: 1,
    }

    return {
      success: true,
      output: {
        content: data.body?.content || '',
        metadata,
        ...details,
        messageId: metadata.messageId,
        sender:
          details.from?.user?.displayName ??
          details.from?.application?.displayName ??
          details.from?.device?.displayName ??
          metadata.messages[0].sender,
        messageType: metadata.messages[0].messageType,
        createdTime: metadata.createdTime,
        url: metadata.url,
      },
    }
  },
}
