import type {
  MicrosoftTeamsListChatsResponse,
  MicrosoftTeamsToolParams,
} from '@/tools/microsoft_teams/types'
import type { ToolConfig } from '@/tools/types'

export const listChatsTool: ToolConfig<MicrosoftTeamsToolParams, MicrosoftTeamsListChatsResponse> =
  {
    id: 'microsoft_teams_list_chats',
    name: 'List Microsoft Teams Chats',
    description: 'List the Microsoft Teams chats the current user is part of',
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
    },

    outputs: {
      success: { type: 'boolean', description: 'Whether the listing was successful' },
      chats: { type: 'array', description: 'Array of chats the user is part of' },
      chatCount: { type: 'number', description: 'Total number of chats' },
    },

    request: {
      // $top=50 is the maximum page size Graph allows for this endpoint.
      url: () => 'https://graph.microsoft.com/v1.0/me/chats?$top=50',
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

    transformResponse: async (response: Response) => {
      const data = await response.json()

      const chats = (data.value || []).map((chat: any) => ({
        id: chat.id || '',
        topic: chat.topic ?? null,
        chatType: chat.chatType || '',
        webUrl: chat.webUrl || '',
        createdDateTime: chat.createdDateTime || '',
        lastUpdatedDateTime: chat.lastUpdatedDateTime || '',
      }))

      return {
        success: true,
        output: {
          chats,
          chatCount: chats.length,
        },
      }
    },
  }
