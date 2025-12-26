import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomGetConversation')

export interface IntercomGetConversationParams {
  accessToken: string
  conversationId: string
  display_as?: string
  include_translations?: boolean
}

export interface IntercomGetConversationResponse {
  success: boolean
  output: {
    conversation: any
    metadata: {
      operation: 'get_conversation'
    }
    success: boolean
  }
}

export const intercomGetConversationTool: ToolConfig<
  IntercomGetConversationParams,
  IntercomGetConversationResponse
> = {
  id: 'intercom_get_conversation',
  name: 'Get Conversation from Intercom',
  description: 'Retrieve a single conversation by ID from Intercom',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Intercom API access token',
    },
    conversationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Conversation ID to retrieve',
    },
    display_as: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to "plaintext" to retrieve messages in plain text',
    },
    include_translations: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'When true, conversation parts will be translated to the detected language of the conversation',
    },
  },

  request: {
    url: (params) => {
      const url = buildIntercomUrl(`/conversations/${params.conversationId}`)
      const queryParams = new URLSearchParams()

      if (params.display_as) queryParams.append('display_as', params.display_as)
      if (params.include_translations !== undefined)
        queryParams.append('include_translations', String(params.include_translations))

      const queryString = queryParams.toString()
      return queryString ? `${url}?${queryString}` : url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'get_conversation')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        conversation: data,
        metadata: {
          operation: 'get_conversation' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Conversation data',
      properties: {
        conversation: { type: 'object', description: 'Conversation object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
