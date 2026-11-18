import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, monacoPageParams } from '@/tools/monaco/params'
import {
  MONACO_CONVERSATION_OUTPUT_PROPERTIES,
  type MonacoGetConversationParams,
  type MonacoGetConversationResponse,
} from '@/tools/monaco/types'
import {
  MONACO_API_BASE,
  mapMonacoConversationDetail,
  monacoHeaders,
  withMonacoPageQuery,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoGetConversationTool: ToolConfig<
  MonacoGetConversationParams,
  MonacoGetConversationResponse
> = {
  id: 'monaco_get_conversation',
  name: 'Monaco Get Conversation',
  description:
    'Get the full ordered thread of one Monaco email or LinkedIn conversation, with participants and paginated messages. Bodies are plain text and truncated past 20,000 characters.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    conversationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Conversation to fetch: the email thread_id or LinkedIn chat_id (the conversation_id from List Messages)',
    },
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Channel of the conversation; must match conversationId. One of email, linkedin.',
    },
    ...monacoPageParams(20, 100),
  },

  request: {
    url: (params) => {
      const url = withMonacoPageQuery(
        `${MONACO_API_BASE}/v1/conversations/${safeUrlPathSegment(params.conversationId, 'conversationId')}`,
        params.page,
        params.pageSize
      )
      const channel = encodeURIComponent(params.channel.trim())
      return `${url}${url.includes('?') ? '&' : '?'}channel=${channel}`
    },
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { conversation: mapMonacoConversationDetail(data.data) } }
  },

  outputs: {
    conversation: {
      type: 'object',
      description: 'The conversation with its participants and messages on this page',
      properties: MONACO_CONVERSATION_OUTPUT_PROPERTIES,
    },
  },
}
