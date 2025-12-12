import type {
  MicrosoftTeamsReactionParams,
  MicrosoftTeamsReactionResponse,
} from '@/tools/microsoft_teams/types'
import type { ToolConfig } from '@/tools/types'

export const setReactionTool: ToolConfig<
  MicrosoftTeamsReactionParams,
  MicrosoftTeamsReactionResponse
> = {
  id: 'microsoft_teams_set_reaction',
  name: 'Add Reaction to Microsoft Teams Message',
  description: 'Add an emoji reaction to a message in Microsoft Teams',
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
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The ID of the team (for channel messages)',
    },
    channelId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The ID of the channel (for channel messages)',
    },
    chatId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The ID of the chat (for chat messages)',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the message to react to',
    },
    reactionType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The emoji reaction (e.g., ❤️, 👍, 😊)',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the reaction was added successfully' },
    reactionType: { type: 'string', description: 'The emoji that was added' },
    messageId: { type: 'string', description: 'ID of the message' },
  },

  request: {
    url: (params) => {
      const messageId = params.messageId?.trim()
      if (!messageId) {
        throw new Error('Message ID is required')
      }

      // Check if it's a channel or chat message
      if (params.teamId && params.channelId) {
        const teamId = params.teamId.trim()
        const channelId = params.channelId.trim()
        return `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/setReaction`
      }
      if (params.chatId) {
        const chatId = params.chatId.trim()
        return `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/setReaction`
      }

      throw new Error('Either (teamId and channelId) or chatId is required')
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      if (!params.reactionType) {
        throw new Error('Reaction type is required')
      }
      return {
        reactionType: params.reactionType,
      }
    },
  },

  transformResponse: async (_response: Response, params?: MicrosoftTeamsReactionParams) => {
    // setReaction returns 204 No Content on success
    return {
      success: true,
      output: {
        success: true,
        reactionType: params?.reactionType || '',
        messageId: params?.messageId || '',
        metadata: {
          messageId: params?.messageId || '',
          teamId: params?.teamId,
          channelId: params?.channelId,
          chatId: params?.chatId,
        },
      },
    }
  },
}
