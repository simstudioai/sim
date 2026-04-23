import type { AgentPhoneGetUsageParams, AgentPhoneGetUsageResult } from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneGetUsageTool: ToolConfig<
  AgentPhoneGetUsageParams,
  AgentPhoneGetUsageResult
> = {
  id: 'agentphone_get_usage',
  name: 'Get Usage',
  description: 'Retrieve current usage statistics for the AgentPhone account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
  },

  request: {
    url: 'https://api.agentphone.to/v1/usage',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<AgentPhoneGetUsageResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to fetch usage',
        output: {
          plan: {
            name: '',
            limits: {
              numbers: null,
              messagesPerMonth: null,
              voiceMinutesPerMonth: null,
              maxCallDurationMinutes: null,
              concurrentCalls: null,
            },
          },
          numbers: { used: null, limit: null, remaining: null },
          stats: {
            totalMessages: null,
            messagesLast24h: null,
            messagesLast7d: null,
            messagesLast30d: null,
            totalCalls: null,
            callsLast24h: null,
            callsLast7d: null,
            callsLast30d: null,
            totalWebhookDeliveries: null,
            successfulWebhookDeliveries: null,
            failedWebhookDeliveries: null,
          },
          periodStart: '',
          periodEnd: '',
        },
      }
    }

    const planLimits = data?.plan?.limits ?? {}
    const numbers = data?.numbers ?? {}
    const stats = data?.stats ?? {}

    return {
      success: true,
      output: {
        plan: {
          name: data?.plan?.name ?? '',
          limits: {
            numbers: planLimits.numbers ?? null,
            messagesPerMonth: planLimits.messagesPerMonth ?? null,
            voiceMinutesPerMonth: planLimits.voiceMinutesPerMonth ?? null,
            maxCallDurationMinutes: planLimits.maxCallDurationMinutes ?? null,
            concurrentCalls: planLimits.concurrentCalls ?? null,
          },
        },
        numbers: {
          used: numbers.used ?? null,
          limit: numbers.limit ?? null,
          remaining: numbers.remaining ?? null,
        },
        stats: {
          totalMessages: stats.totalMessages ?? null,
          messagesLast24h: stats.messagesLast24h ?? null,
          messagesLast7d: stats.messagesLast7d ?? null,
          messagesLast30d: stats.messagesLast30d ?? null,
          totalCalls: stats.totalCalls ?? null,
          callsLast24h: stats.callsLast24h ?? null,
          callsLast7d: stats.callsLast7d ?? null,
          callsLast30d: stats.callsLast30d ?? null,
          totalWebhookDeliveries: stats.totalWebhookDeliveries ?? null,
          successfulWebhookDeliveries: stats.successfulWebhookDeliveries ?? null,
          failedWebhookDeliveries: stats.failedWebhookDeliveries ?? null,
        },
        periodStart: data.periodStart ?? '',
        periodEnd: data.periodEnd ?? '',
      },
    }
  },

  outputs: {
    plan: {
      type: 'json',
      description:
        'Plan name and limits (name, limits: numbers/messagesPerMonth/voiceMinutesPerMonth/maxCallDurationMinutes/concurrentCalls)',
    },
    numbers: {
      type: 'json',
      description: 'Phone number usage (used, limit, remaining)',
    },
    stats: {
      type: 'json',
      description:
        'Usage stats: totalMessages, messagesLast24h/7d/30d, totalCalls, callsLast24h/7d/30d, totalWebhookDeliveries, successfulWebhookDeliveries, failedWebhookDeliveries',
    },
    periodStart: { type: 'string', description: 'Billing period start' },
    periodEnd: { type: 'string', description: 'Billing period end' },
  },
}
