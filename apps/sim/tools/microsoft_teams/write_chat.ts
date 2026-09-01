import type {
  MicrosoftTeamsToolParams,
  MicrosoftTeamsWriteResponse,
} from '@/tools/microsoft_teams/types'
import type { InternalToolConfig } from '@/tools/types'

export const writeChatTool: InternalToolConfig<
  MicrosoftTeamsToolParams,
  MicrosoftTeamsWriteResponse
> = {
  id: 'microsoft_teams_write_chat',
  name: 'Write to Microsoft Teams Chat',
  description: 'Write or update content in a Microsoft Teams chat',
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
        'The ID of the chat to write to (e.g., "19:abc123def456@thread.v2" - from chat listings)',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The content to write to the message (plain text or HTML formatted, supports @mentions)',
    },
    files: {
      type: 'file[]',
      required: false,
      visibility: 'user-only',
      description: 'Files to attach to the message',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Teams chat message send success status' },
    messageId: { type: 'string', description: 'Unique identifier for the sent message' },
    chatId: { type: 'string', description: 'ID of the chat where message was sent' },
    createdTime: { type: 'string', description: 'Timestamp when message was created' },
    url: { type: 'string', description: 'Web URL to the message' },
    updatedContent: { type: 'boolean', description: 'Whether content was successfully updated' },
    files: { type: 'file[]', description: 'Files attached to the message' },
  },

  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      chatId: params.chatId,
      content: params.content,
      files: params.files ?? null,
    }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) throw new Error(data.error || 'Failed to send Teams message')
    return data
  },
}
