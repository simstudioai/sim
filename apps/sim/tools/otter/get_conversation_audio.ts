import { toStringOrNull } from '@sim/utils/coerce'
import type {
  OtterGetConversationAudioParams,
  OtterGetConversationAudioResponse,
} from '@/tools/otter/types'
import {
  OTTER_API_BASE,
  OTTER_RETRIEVED_AT_OUTPUT,
  otterHeaders,
  readOtterDataObject,
  readOtterRetrievedAt,
} from '@/tools/otter/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const otterGetConversationAudioTool: ToolConfig<
  OtterGetConversationAudioParams,
  OtterGetConversationAudioResponse
> = {
  id: 'otter_get_conversation_audio',
  name: 'Otter Get Conversation Audio',
  description: 'Get the MP3 audio download link for an Otter conversation.',
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
  },

  request: {
    url: (params) =>
      `${OTTER_API_BASE}/conversations/${safeUrlPathSegment(params.conversationId, 'conversationId')}/audio`,
    method: 'GET',
    headers: (params) => otterHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const body = await response.json()
    return {
      success: true,
      output: {
        audioUrl: toStringOrNull(readOtterDataObject(body).url),
        retrievedAt: readOtterRetrievedAt(body),
      },
    }
  },

  outputs: {
    audioUrl: {
      type: 'string',
      description: 'Download URL for the conversation MP3 audio',
      nullable: true,
    },
    retrievedAt: OTTER_RETRIEVED_AT_OUTPUT,
  },
}
