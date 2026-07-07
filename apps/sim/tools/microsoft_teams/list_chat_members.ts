import type {
  MicrosoftTeamsListMembersResponse,
  MicrosoftTeamsToolParams,
} from '@/tools/microsoft_teams/types'
import type { ToolConfig } from '@/tools/types'

export const listChatMembersTool: ToolConfig<
  MicrosoftTeamsToolParams,
  MicrosoftTeamsListMembersResponse
> = {
  id: 'microsoft_teams_list_chat_members',
  name: 'List Microsoft Teams Chat Members',
  description: 'List all members of a Microsoft Teams chat',
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
      description: 'The ID of the chat (e.g., "19:abc123def456@thread.v2" - from chat listings)',
    },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the listing was successful' },
    members: { type: 'array', description: 'Array of chat members' },
    memberCount: { type: 'number', description: 'Total number of members' },
  },

  request: {
    url: (params) => {
      const chatId = params.chatId?.trim()
      if (!chatId) {
        throw new Error('Chat ID is required')
      }
      return `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/members`
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

  transformResponse: async (response: Response, params?: MicrosoftTeamsToolParams) => {
    const data = await response.json()

    const members = (data.value || []).map((member: any) => ({
      id: member.id || '',
      displayName: member.displayName || '',
      email: member.email || '',
      userId: member.userId || '',
      roles: member.roles || [],
    }))

    return {
      success: true,
      output: {
        members,
        memberCount: members.length,
        metadata: {
          chatId: params?.chatId || '',
        },
      },
    }
  },
}
