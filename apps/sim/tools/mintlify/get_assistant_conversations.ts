import type {
  MintlifyConversation,
  MintlifyGetAssistantConversationsParams,
  MintlifyGetAssistantConversationsResponse,
} from '@/tools/mintlify/types'
import {
  appendParam,
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toNullableString,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

function toConversations(value: unknown): MintlifyConversation[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const conversation = (item ?? {}) as Record<string, unknown>
    const sources = Array.isArray(conversation.sources) ? conversation.sources : []

    return {
      id: toNullableString(conversation.id),
      timestamp: toNullableString(conversation.timestamp),
      query: toNullableString(conversation.query),
      response: toNullableString(conversation.response),
      sources: sources.map((entry) => {
        const source = (entry ?? {}) as Record<string, unknown>
        return {
          title: toNullableString(source.title),
          url: toNullableString(source.url),
        }
      }),
      resolutionStatus: toNullableString(conversation.resolutionStatus),
      queryCategory: toNullableString(conversation.queryCategory),
      pageUrl: toNullableString(conversation.pageUrl),
    }
  })
}

export const mintlifyGetAssistantConversationsTool: ToolConfig<
  MintlifyGetAssistantConversationsParams,
  MintlifyGetAssistantConversationsResponse
> = {
  id: 'mintlify_get_assistant_conversations',
  name: 'Mintlify Get Assistant Conversations',
  description:
    'Export paginated Mintlify AI assistant conversation history, including the query, response, cited sources, and whether the question was answered.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mintlify project ID, copied from the API keys page in your dashboard',
    },
    dateFrom: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inclusive start date in ISO 8601 or YYYY-MM-DD format',
    },
    dateTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclusive end date in ISO 8601 or YYYY-MM-DD format',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max results per page, between 1 and 1000 (default 100)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ULID pagination cursor returned as nextCursor by a previous call',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify admin API key (starts with mint_)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${MINTLIFY_API_BASE}/v1/analytics/${pathSegment(params.projectId)}/assistant`
      )
      appendParam(url, 'dateFrom', params.dateFrom)
      appendParam(url, 'dateTo', params.dateTo)
      appendParam(url, 'limit', params.limit)
      appendParam(url, 'cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => mintlifyHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to get Mintlify assistant conversations')

    return {
      success: true,
      output: {
        conversations: toConversations(data.conversations),
        nextCursor: toNullableString(data.nextCursor),
        hasMore: data.hasMore === true,
      },
    }
  },

  outputs: {
    conversations: {
      type: 'array',
      description: 'Assistant conversations for the requested window',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique conversation identifier', nullable: true },
          timestamp: {
            type: 'string',
            description: 'When the conversation occurred',
            nullable: true,
          },
          query: { type: 'string', description: "The user's question", nullable: true },
          response: { type: 'string', description: "The assistant's response", nullable: true },
          sources: {
            type: 'array',
            description: 'Documentation pages referenced in the response',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Title of the page', nullable: true },
                url: { type: 'string', description: 'URL of the page', nullable: true },
              },
            },
          },
          resolutionStatus: {
            type: 'string',
            description: 'Whether the assistant answered the question: answered or unanswered',
            nullable: true,
          },
          queryCategory: {
            type: 'string',
            description: 'Auto-assigned category grouping for the conversation',
            nullable: true,
          },
          pageUrl: {
            type: 'string',
            description: 'Full URL of the page where the conversation started',
            nullable: true,
          },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page, or null when there are no more results',
      nullable: true,
    },
    hasMore: { type: 'boolean', description: 'Whether additional results are available' },
  },
}
