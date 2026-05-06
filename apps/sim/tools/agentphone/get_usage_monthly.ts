import type {
  AgentPhoneGetUsageMonthlyParams,
  AgentPhoneGetUsageMonthlyResult,
  AgentPhoneUsageMonthlyEntry,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneGetUsageMonthlyTool: ToolConfig<
  AgentPhoneGetUsageMonthlyParams,
  AgentPhoneGetUsageMonthlyResult
> = {
  id: 'agentphone_get_usage_monthly',
  name: 'Get Monthly Usage',
  description: 'Get monthly usage aggregation (messages, calls, webhooks) for the last N months',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    months: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of months to return (1-24, default 6)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (typeof params.months === 'number') query.set('months', String(params.months))
      const qs = query.toString()
      return `https://api.agentphone.to/v1/usage/monthly${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<AgentPhoneGetUsageMonthlyResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to fetch monthly usage',
        output: { data: [], months: 0 },
      }
    }

    return {
      success: true,
      output: {
        data: (data.data ?? []).map(
          (entry: Record<string, unknown>): AgentPhoneUsageMonthlyEntry => ({
            month: (entry.month as string) ?? '',
            messages: (entry.messages as number) ?? 0,
            calls: (entry.calls as number) ?? 0,
            webhooks: (entry.webhooks as number) ?? 0,
          })
        ),
        months: data.months ?? 0,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Monthly usage entries',
      items: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'Month (YYYY-MM)' },
          messages: { type: 'number', description: 'Messages that month' },
          calls: { type: 'number', description: 'Calls that month' },
          webhooks: { type: 'number', description: 'Webhook deliveries that month' },
        },
      },
    },
    months: { type: 'number', description: 'Number of months returned' },
  },
}
