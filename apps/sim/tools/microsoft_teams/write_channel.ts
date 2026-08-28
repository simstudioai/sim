import type {
  MicrosoftTeamsToolParams,
  MicrosoftTeamsWriteResponse,
} from '@/tools/microsoft_teams/types'
import type { InternalToolConfig } from '@/tools/types'

export const writeChannelTool: InternalToolConfig<
  MicrosoftTeamsToolParams,
  MicrosoftTeamsWriteResponse
> = {
  id: 'microsoft_teams_write_channel',
  name: 'Write to Microsoft Teams Channel',
  description: 'Write or send a message to a Microsoft Teams channel',
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
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the team to write to (e.g., "12345678-abcd-1234-efgh-123456789012" - a GUID from team listings)',
    },
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the channel to write to (e.g., "19:abc123def456@thread.tacv2" - from channel listings)',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The content to write to the channel (plain text or HTML formatted, supports @mentions)',
    },
    files: {
      type: 'file[]',
      required: false,
      visibility: 'user-only',
      description: 'Files to attach to the message',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Teams channel message send success status' },
    messageId: { type: 'string', description: 'Unique identifier for the sent message' },
    teamId: { type: 'string', description: 'ID of the team where message was sent' },
    channelId: { type: 'string', description: 'ID of the channel where message was sent' },
    createdTime: { type: 'string', description: 'Timestamp when message was created' },
    url: { type: 'string', description: 'Web URL to the message' },
    updatedContent: { type: 'boolean', description: 'Whether content was successfully updated' },
    files: { type: 'file[]', description: 'Files attached to the message' },
  },

  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      teamId: params.teamId,
      channelId: params.channelId,
      content: params.content,
      files: params.files ?? null,
    }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) throw new Error(data.error || 'Failed to send Teams channel message')
    return data
  },
}
