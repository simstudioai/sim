import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomTagConversationParams {
  accessToken: string
  conversationId: string
  tagId: string
  admin_id: string
}

export interface IntercomTagConversationV2Response {
  success: boolean
  output: {
    id: string
    name: string
    type: string
  }
}

const tagConversationBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    conversationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the conversation to tag',
    },
    tagId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the tag to apply',
    },
    admin_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the admin applying the tag',
    },
  },

  request: {
    url: (params: IntercomTagConversationParams) =>
      buildIntercomUrl(`/conversations/${params.conversationId}/tags`),
    method: 'POST',
    headers: (params: IntercomTagConversationParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomTagConversationParams) => ({
      id: params.tagId,
      admin_id: params.admin_id,
    }),
  },
} satisfies Pick<ToolConfig<IntercomTagConversationParams, any>, 'params' | 'request'>

export const intercomTagConversationV2Tool: ToolConfig<
  IntercomTagConversationParams,
  IntercomTagConversationV2Response
> = {
  ...tagConversationBase,
  id: 'intercom_tag_conversation_v2',
  name: 'Tag Conversation in Intercom',
  description: 'Add a tag to a specific conversation',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'tag_conversation')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        type: data.type ?? 'tag',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique identifier for the tag' },
    name: { type: 'string', description: 'Name of the tag' },
    type: { type: 'string', description: 'Object type (tag)' },
  },
}
