import type {
  AgentPhoneReactToMessageParams,
  AgentPhoneReactToMessageResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneReactToMessageTool: ToolConfig<
  AgentPhoneReactToMessageParams,
  AgentPhoneReactToMessageResult
> = {
  id: 'agentphone_react_to_message',
  name: 'React to Message',
  description: 'Send an iMessage tapback reaction to a message (iMessage only)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the message to react to',
    },
    reaction: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reaction type: love, like, dislike, laugh, emphasize, or question',
    },
  },

  request: {
    url: (params) => `https://api.agentphone.to/v1/messages/${params.messageId.trim()}/reactions`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ reaction: params.reaction }),
  },

  transformResponse: async (response, params): Promise<AgentPhoneReactToMessageResult> => {
    const data = await response.json()
    const messageId = params?.messageId?.trim() ?? ''

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to send reaction',
        output: { id: '', reactionType: '', messageId, channel: '' },
      }
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        reactionType: data.reaction_type ?? '',
        messageId: data.message_id ?? messageId,
        channel: data.channel ?? '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Reaction ID' },
    reactionType: { type: 'string', description: 'Reaction type applied' },
    messageId: { type: 'string', description: 'ID of the message that was reacted to' },
    channel: { type: 'string', description: 'Channel (imessage)' },
  },
}
