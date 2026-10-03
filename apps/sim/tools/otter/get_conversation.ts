import type { OtterGetConversationParams, OtterGetConversationResponse } from '@/tools/otter/types'
import {
  mapOtterConversationDetail,
  normalizeOtterInclude,
  OTTER_API_BASE,
  OTTER_CONVERSATION_PROPERTIES,
  OTTER_CONVERSATION_RELATIONSHIP_PROPERTIES,
  OTTER_RETRIEVED_AT_OUTPUT,
  otterHeaders,
  readOtterDataObject,
  readOtterRetrievedAt,
} from '@/tools/otter/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const otterGetConversationTool: ToolConfig<
  OtterGetConversationParams,
  OtterGetConversationResponse
> = {
  id: 'otter_get_conversation',
  name: 'Otter Get Conversation',
  description:
    'Get an Otter conversation with its summary and details, plus any requested action items, insights, outline, and transcript.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Otter API key',
    },
    conversationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Otter conversation ID',
    },
    include: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated related data to include: action_items, insights, outline, transcript, or all (e.g., "insights,transcript")',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${OTTER_API_BASE}/conversations/${safeUrlPathSegment(params.conversationId, 'conversationId')}`
      )
      url.searchParams.set('include', normalizeOtterInclude(params.include))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => otterHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const body = await response.json()
    return {
      success: true,
      output: {
        ...mapOtterConversationDetail(readOtterDataObject(body), body),
        retrievedAt: readOtterRetrievedAt(body),
      },
    }
  },

  outputs: {
    ...OTTER_CONVERSATION_PROPERTIES,
    ...OTTER_CONVERSATION_RELATIONSHIP_PROPERTIES,
    retrievedAt: OTTER_RETRIEVED_AT_OUTPUT,
  },
}
