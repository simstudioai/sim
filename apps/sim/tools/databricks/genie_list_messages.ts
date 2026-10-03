import {
  type DatabricksGenieListMessagesParams,
  type DatabricksGenieListMessagesResponse,
  GENIE_MESSAGE_OUTPUT_PROPERTIES,
} from '@/tools/databricks/types'
import {
  databricksErrorMessage,
  databricksUrl,
  GENIE_READ_RETRY,
  GENIE_SPACE_PARAMS,
  type GenieMessagePayload,
  genieConversationPath,
  mapGenieMessage,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const genieListMessagesTool: ToolConfig<
  DatabricksGenieListMessagesParams,
  DatabricksGenieListMessagesResponse
> = {
  id: 'databricks_genie_list_messages',
  name: 'Databricks Genie List Messages',
  description:
    'List the messages in a Genie conversation with their answers and generated SQL, for example to replay a conversation history.',
  version: '1.0.0',

  params: {
    ...GENIE_SPACE_PARAMS,
    conversationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the Genie conversation',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of messages to return per page (default 20, max 100)',
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
        databricksUrl(
          params.host,
          `${genieConversationPath(params.spaceId, params.conversationId)}/messages`
        )
      )
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
      throw new Error(databricksErrorMessage(data, 'Failed to list Genie messages'))
    }

    const messages: GenieMessagePayload[] = data.messages ?? []

    return {
      success: true,
      output: {
        messages: messages.map(mapGenieMessage),
        nextPageToken: data.next_page_token ?? null,
      },
    }
  },

  outputs: {
    messages: {
      type: 'array',
      description: 'Messages in the conversation',
      items: {
        type: 'object',
        properties: GENIE_MESSAGE_OUTPUT_PROPERTIES,
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page of results',
      nullable: true,
    },
  },
}
