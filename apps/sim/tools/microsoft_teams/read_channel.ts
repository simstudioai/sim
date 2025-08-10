import { createLogger } from '@/lib/logs/console/logger'
import type {
  MicrosoftTeamsReadResponse,
  MicrosoftTeamsToolParams,
} from '@/tools/microsoft_teams/types'
import { extractMessageAttachments } from '@/tools/microsoft_teams/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftTeamsReadChannel')

export const readChannelTool: ToolConfig<MicrosoftTeamsToolParams, MicrosoftTeamsReadResponse> = {
  id: 'microsoft_teams_read_channel',
  name: 'Read Microsoft Teams Channel',
  description: 'Read content from a Microsoft Teams channel',
  version: '1.0',

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
      required: true,
      visibility: 'user-only',
      description: 'The ID of the team to read from',
    },
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the channel to read from',
    },
  },

  request: {
    url: (params) => {
      const teamId = params.teamId?.trim()
      if (!teamId) {
        throw new Error('Team ID is required')
      }

      const channelId = params.channelId?.trim()
      if (!channelId) {
        throw new Error('Channel ID is required')
      }

      // URL encode the IDs to handle special characters
      const encodedTeamId = encodeURIComponent(teamId)
      const encodedChannelId = encodeURIComponent(channelId)

      // Fetch the most recent messages from the channel
      const url = `https://graph.microsoft.com/v1.0/teams/${encodedTeamId}/channels/${encodedChannelId}/messages`

      return url
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
    const data = await response.json()

    // Microsoft Graph API returns messages in a 'value' array
    const messages = data.value || []

    if (messages.length === 0) {
      return {
        success: true,
        output: {
          content: 'No messages found in this channel.',
          metadata: {
            teamId: '',
            channelId: '',
            messageCount: 0,
            messages: [],
            totalAttachments: 0,
            attachmentTypes: [],
          },
        },
      }
    }

    // Process messages with attachments
    const processedMessages = messages.map((message: any, index: number) => {
      try {
        const content = message.body?.content || 'No content'
        const messageId = message.id

        const attachments = extractMessageAttachments(message)

        let sender = 'Unknown'
        if (message.from?.user?.displayName) {
          sender = message.from.user.displayName
        } else if (message.messageType === 'systemEventMessage') {
          sender = 'System'
        }

        return {
          id: messageId,
          content: content,
          sender,
          timestamp: message.createdDateTime,
          messageType: message.messageType || 'message',
          attachments,
        }
      } catch (error) {
        logger.error(`Error processing message at index ${index}:`, error)
        return {
          id: message.id || `unknown-${index}`,
          content: 'Error processing message',
          sender: 'Unknown',
          timestamp: message.createdDateTime || new Date().toISOString(),
          messageType: 'error',
          attachments: [],
        }
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
      teamId: messages[0]?.channelIdentity?.teamId || params?.teamId || '',
      channelId: messages[0]?.channelIdentity?.channelId || params?.channelId || '',
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

  outputs: {
    success: { type: 'boolean', description: 'Teams channel read operation success status' },
    messageCount: { type: 'number', description: 'Number of messages retrieved from channel' },
    teamId: { type: 'string', description: 'ID of the team that was read from' },
    channelId: { type: 'string', description: 'ID of the channel that was read from' },
    messages: { type: 'array', description: 'Array of channel message objects' },
    attachmentCount: { type: 'number', description: 'Total number of attachments found' },
    attachmentTypes: { type: 'array', description: 'Types of attachments found' },
    content: { type: 'string', description: 'Formatted content of channel messages' },
  },
}
