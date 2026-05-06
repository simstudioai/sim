import type {
  AgentPhoneCreateCallParams,
  AgentPhoneCreateCallResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneCreateCallTool: ToolConfig<
  AgentPhoneCreateCallParams,
  AgentPhoneCreateCallResult
> = {
  id: 'agentphone_create_call',
  name: 'Create Outbound Call',
  description: 'Initiate an outbound voice call from an AgentPhone agent',
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
      description: 'Agent that will handle the call',
    },
    toNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Phone number to call in E.164 format (e.g. +14155551234)',
    },
    fromNumberId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Phone number ID to use as caller ID. Must belong to the agent. If omitted, the agent's first assigned number is used.",
    },
    initialGreeting: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional greeting spoken when the recipient answers',
    },
    voice: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Voice ID override for this call (defaults to the agent's configured voice)",
    },
    systemPrompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'When provided, uses a built-in LLM for the conversation instead of forwarding to your webhook',
    },
  },

  request: {
    url: 'https://api.agentphone.to/v1/calls',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        agentId: params.agentId,
        toNumber: params.toNumber,
      }
      if (params.fromNumberId) body.fromNumberId = params.fromNumberId
      if (params.initialGreeting) body.initialGreeting = params.initialGreeting
      if (params.voice) body.voice = params.voice
      if (params.systemPrompt) body.systemPrompt = params.systemPrompt
      return body
    },
  },

  transformResponse: async (response): Promise<AgentPhoneCreateCallResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to create call',
        output: {
          id: '',
          agentId: null,
          status: null,
          toNumber: null,
          fromNumber: null,
          phoneNumberId: null,
          direction: null,
          startedAt: null,
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id ?? data.callId ?? '',
        agentId: data.agentId ?? null,
        status: data.status ?? null,
        toNumber: data.toNumber ?? null,
        fromNumber: data.fromNumber ?? null,
        phoneNumberId: data.phoneNumberId ?? null,
        direction: data.direction ?? null,
        startedAt: data.startedAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique call identifier' },
    agentId: { type: 'string', description: 'Agent handling the call', optional: true },
    status: { type: 'string', description: 'Initial call status', optional: true },
    toNumber: { type: 'string', description: 'Destination phone number', optional: true },
    fromNumber: { type: 'string', description: 'Caller ID used for the call', optional: true },
    phoneNumberId: {
      type: 'string',
      description: 'ID of the phone number used as caller ID',
      optional: true,
    },
    direction: { type: 'string', description: 'Call direction (outbound)', optional: true },
    startedAt: { type: 'string', description: 'ISO 8601 timestamp', optional: true },
  },
}
