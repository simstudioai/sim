import type { AffinityCollectionResponse, AffinityFilterParams } from '@/tools/affinity/types'
import { CHAT_MESSAGE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import { affinityHeaders, buildAffinityUrl, transformCollection } from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListChatMessagesTool: ToolConfig<
  AffinityFilterParams,
  AffinityCollectionResponse<'chatMessages'>
> = {
  id: 'affinity_list_chat_messages',
  name: 'Affinity List Chat Messages',
  description:
    'Page through logged chat messages and their participants. Only messages the API key holder can see are returned.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Affinity Filtering Language expression, e.g. "createdAt>=2026-01-01"',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from a previous page, returned as nextCursor or prevCursor',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of items to return per page, 1-100. Defaults to 100',
    },
  },

  request: {
    url: (params) =>
      buildAffinityUrl('/chat-messages', {
        filter: params.filter,
        cursor: params.cursor,
        limit: params.limit,
      }),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('chatMessages'),

  outputs: {
    chatMessages: {
      type: 'array',
      description: 'Logged chat messages',
      items: { type: 'object', properties: CHAT_MESSAGE_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of rows on this page' },
    nextCursor: {
      type: 'string',
      nullable: true,
      description: 'Cursor for the next page, or null on the last page',
    },
    prevCursor: {
      type: 'string',
      nullable: true,
      description: 'Cursor for the previous page, or null on the first page',
    },
  },
}
