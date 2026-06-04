import type {
  AgentPhoneListNumbersParams,
  AgentPhoneListNumbersResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneListNumbersTool: ToolConfig<
  AgentPhoneListNumbersParams,
  AgentPhoneListNumbersResult
> = {
  id: 'agentphone_list_numbers',
  name: 'List Phone Numbers',
  description: 'List all phone numbers provisioned for this AgentPhone account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default 20, max 100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip (min 0)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (typeof params.limit === 'number') query.set('limit', String(params.limit))
      if (typeof params.offset === 'number') query.set('offset', String(params.offset))
      const qs = query.toString()
      return `https://api.agentphone.to/v1/numbers${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<AgentPhoneListNumbersResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to list phone numbers',
        output: { data: [], hasMore: false, total: 0 },
      }
    }

    return {
      success: true,
      output: {
        data: (data.data ?? []).map((num: Record<string, unknown>) => ({
          id: (num.id as string) ?? '',
          phoneNumber: (num.phoneNumber as string) ?? '',
          country: (num.country as string) ?? '',
          status: (num.status as string) ?? '',
          type: (num.type as string) ?? '',
          agentId: (num.agentId as string | null) ?? null,
          createdAt: (num.createdAt as string) ?? '',
        })),
        hasMore: data.hasMore ?? false,
        total: data.total ?? 0,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Phone numbers',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Phone number ID' },
          phoneNumber: { type: 'string', description: 'Phone number in E.164 format' },
          country: { type: 'string', description: 'Two-letter country code' },
          status: { type: 'string', description: 'Number status' },
          type: { type: 'string', description: 'Number type (e.g. sms)', optional: true },
          agentId: { type: 'string', description: 'Attached agent ID', optional: true },
          createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
        },
      },
    },
    hasMore: { type: 'boolean', description: 'Whether more results are available' },
    total: { type: 'number', description: 'Total number of phone numbers' },
  },
}
