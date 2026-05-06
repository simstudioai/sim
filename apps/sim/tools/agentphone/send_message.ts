import type {
  AgentPhoneSendMessageParams,
  AgentPhoneSendMessageResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneSendMessageTool: ToolConfig<
  AgentPhoneSendMessageParams,
  AgentPhoneSendMessageResult
> = {
  id: 'agentphone_send_message',
  name: 'Send Message',
  description: 'Send an outbound SMS or iMessage from an AgentPhone agent',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    agentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Agent sending the message',
    },
    toNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient phone number in E.164 format (e.g. +14155551234)',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message text to send',
    },
    mediaUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional URL of an image, video, or file to attach',
    },
    numberId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Phone number ID to send from. If omitted, the agent's first assigned number is used.",
    },
  },

  request: {
    url: 'https://api.agentphone.to/v1/messages',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        agent_id: params.agentId,
        to_number: params.toNumber,
        body: params.body,
      }
      if (params.mediaUrl) body.media_url = params.mediaUrl
      if (params.numberId) body.number_id = params.numberId
      return body
    },
  },

  transformResponse: async (response): Promise<AgentPhoneSendMessageResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to send message',
        output: { id: '', status: '', channel: '', fromNumber: '', toNumber: '' },
      }
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        status: data.status ?? '',
        channel: data.channel ?? '',
        fromNumber: data.from_number ?? '',
        toNumber: data.to_number ?? '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Message ID' },
    status: { type: 'string', description: 'Delivery status' },
    channel: { type: 'string', description: 'sms, mms, or imessage' },
    fromNumber: { type: 'string', description: 'Sender phone number' },
    toNumber: { type: 'string', description: 'Recipient phone number' },
  },
}
