import type {
  AgentPhoneCreateNumberParams,
  AgentPhoneCreateNumberResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneCreateNumberTool: ToolConfig<
  AgentPhoneCreateNumberParams,
  AgentPhoneCreateNumberResult
> = {
  id: 'agentphone_create_number',
  name: 'Create Phone Number',
  description: 'Provision a new SMS- and voice-enabled phone number',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter country code (e.g. US, CA). Defaults to US.',
    },
    areaCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Preferred area code (US/CA only, e.g. "415"). Best-effort — may be ignored if unavailable.',
    },
    agentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optionally attach the number to an agent immediately',
    },
  },

  request: {
    url: 'https://api.agentphone.to/v1/numbers',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.country) body.country = params.country
      if (params.areaCode) body.areaCode = params.areaCode
      if (params.agentId) body.agentId = params.agentId
      return body
    },
  },

  transformResponse: async (response): Promise<AgentPhoneCreateNumberResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to create phone number',
        output: {
          id: '',
          phoneNumber: '',
          country: '',
          status: '',
          type: '',
          agentId: null,
          createdAt: '',
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        phoneNumber: data.phoneNumber ?? '',
        country: data.country ?? '',
        status: data.status ?? '',
        type: data.type ?? '',
        agentId: data.agentId ?? null,
        createdAt: data.createdAt ?? '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique phone number ID' },
    phoneNumber: { type: 'string', description: 'Provisioned phone number in E.164 format' },
    country: { type: 'string', description: 'Two-letter country code' },
    status: { type: 'string', description: 'Number status (e.g. active)' },
    type: { type: 'string', description: 'Number type (e.g. sms)', optional: true },
    agentId: {
      type: 'string',
      description: 'Agent the number is attached to',
      optional: true,
    },
    createdAt: { type: 'string', description: 'ISO 8601 timestamp when the number was created' },
  },
}
