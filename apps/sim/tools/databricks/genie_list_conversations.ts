import type {
  DatabricksGenieListConversationsParams,
  DatabricksGenieListConversationsResponse,
} from '@/tools/databricks/types'
import {
  databricksErrorMessage,
  databricksUrl,
  GENIE_READ_RETRY,
  GENIE_SPACE_PARAMS,
  genieSpacePath,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const genieListConversationsTool: ToolConfig<
  DatabricksGenieListConversationsParams,
  DatabricksGenieListConversationsResponse
> = {
  id: 'databricks_genie_list_conversations',
  name: 'Databricks Genie List Conversations',
  description:
    'List conversations in a Genie space, including whether each is a chat-mode or agent-mode conversation. By default only your own conversations are returned.',
  version: '1.0.0',

  params: {
    ...GENIE_SPACE_PARAMS,
    includeAll: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Include every user's conversations in the space (requires CAN MANAGE on the space)",
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of conversations to return per page (default 20, max 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        databricksUrl(params.host, `${genieSpacePath(params.spaceId)}/conversations`)
      )
      if (params.includeAll) url.searchParams.set('include_all', 'true')
      if (params.pageSize) url.searchParams.set('page_size', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('page_token', params.pageToken)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    retry: GENIE_READ_RETRY,
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(databricksErrorMessage(data, 'Failed to list Genie conversations'))
    }

    const conversations = (data.conversations ?? []).map(
      (conversation: {
        conversation_id?: string
        title?: string
        created_timestamp?: number
        agent_type?: string
      }) => ({
        conversationId: conversation.conversation_id ?? '',
        title: conversation.title ?? null,
        createdTimestamp: conversation.created_timestamp ?? null,
        agentType: conversation.agent_type ?? null,
      })
    )

    return {
      success: true,
      output: {
        conversations,
        nextPageToken: data.next_page_token ?? null,
      },
    }
  },

  outputs: {
    conversations: {
      type: 'array',
      description: 'Conversations in the Genie space',
      items: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'Conversation ID' },
          title: { type: 'string', description: 'Conversation title', nullable: true },
          createdTimestamp: {
            type: 'number',
            description: 'When the conversation was created',
            nullable: true,
          },
          agentType: {
            type: 'string',
            description:
              'Conversation mode (GENIE_CONVERSATION_TYPE_CHAT or GENIE_CONVERSATION_TYPE_AGENT)',
            nullable: true,
          },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page of results',
      nullable: true,
    },
  },
}
