import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_MESSAGE_ROW_OUTPUT_PROPERTIES,
  type MonacoListMessagesParams,
  type MonacoListMessagesResponse,
} from '@/tools/monaco/types'
import {
  MONACO_API_BASE,
  mapMonacoMessageRow,
  monacoHeaders,
  parseMonacoIdList,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoListMessagesTool: ToolConfig<
  MonacoListMessagesParams,
  MonacoListMessagesResponse
> = {
  id: 'monaco_list_messages',
  name: 'Monaco List Messages',
  description:
    "List the email and LinkedIn conversation history for a contact or account as one recency-ordered feed, one row per conversation. Pass a row's conversation_id and channel to Get Conversation for the full thread. Paginates with a cursor.",
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    contactId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "ID (UUID) of a contact to scope the feed to that contact's message history",
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "ID (UUID) of an account to scope the feed to that account's message history",
    },
    channels: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Channels to include, as an array or comma-separated list. Each is one of email, linkedin. Omit to include all channels.',
      items: { type: 'string', description: 'Channel (email or linkedin)' },
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque nextCursor from a previous response; omit for the first page',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page, from 1 to 100. Defaults to 25.',
    },
  },

  request: {
    url: `${MONACO_API_BASE}/v1/messages/list`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = {}
      const contactId = params.contactId?.trim()
      if (contactId) body.contact_id = contactId
      const accountId = params.accountId?.trim()
      if (accountId) body.account_id = accountId
      const cursor = params.cursor?.trim()
      if (cursor) body.cursor = cursor
      const hasChannels =
        Array.isArray(params.channels) ||
        (typeof params.channels === 'string' && params.channels.trim().length > 0)
      if (hasChannels) body.channels = parseMonacoIdList(params.channels, 'channels')
      if (params.pageSize !== undefined) body.page_size = params.pageSize
      return body
    },
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        messages: toArray(data.data).map(mapMonacoMessageRow),
        nextCursor: toStringOrNull(data.next_cursor),
        hasMore: data.has_more === true,
      },
    }
  },

  outputs: {
    messages: {
      type: 'array',
      description: 'Conversations on this page, most recent first',
      items: { type: 'object', properties: MONACO_MESSAGE_ROW_OUTPUT_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      description: 'Pass back as cursor to fetch the next page; null when there are no more',
      nullable: true,
    },
    hasMore: { type: 'boolean', description: 'Whether more pages are available' },
  },
}
