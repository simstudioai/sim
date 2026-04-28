import type {
  AgentPhoneGetUsageDailyParams,
  AgentPhoneGetUsageDailyResult,
  AgentPhoneUsageDailyEntry,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneGetUsageDailyTool: ToolConfig<
  AgentPhoneGetUsageDailyParams,
  AgentPhoneGetUsageDailyResult
> = {
  id: 'agentphone_get_usage_daily',
  name: 'Get Daily Usage',
  description: 'Get a daily breakdown of usage (messages, calls, webhooks) for the last N days',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    days: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of days to return (1-365, default 30)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (typeof params.days === 'number') query.set('days', String(params.days))
      const qs = query.toString()
      return `https://api.agentphone.to/v1/usage/daily${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<AgentPhoneGetUsageDailyResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to fetch daily usage',
        output: { data: [], days: 0 },
      }
    }

    return {
      success: true,
      output: {
        data: (data.data ?? []).map(
          (entry: Record<string, unknown>): AgentPhoneUsageDailyEntry => ({
            date: (entry.date as string) ?? '',
            messages: (entry.messages as number) ?? 0,
            calls: (entry.calls as number) ?? 0,
            webhooks: (entry.webhooks as number) ?? 0,
          })
        ),
        days: data.days ?? 0,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Daily usage entries',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Day (YYYY-MM-DD)' },
          messages: { type: 'number', description: 'Messages that day' },
          calls: { type: 'number', description: 'Calls that day' },
          webhooks: { type: 'number', description: 'Webhook deliveries that day' },
        },
      },
    },
    days: { type: 'number', description: 'Number of days returned' },
  },
}
