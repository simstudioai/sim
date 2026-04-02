import type { RootlyListOnCallsParams, RootlyListOnCallsResponse } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyListOnCallsTool: ToolConfig<RootlyListOnCallsParams, RootlyListOnCallsResponse> =
  {
    id: 'rootly_list_on_calls',
    name: 'Rootly List On-Calls',
    description: 'List current on-call entries from Rootly with optional filtering.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Rootly API key',
      },
      scheduleIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated schedule IDs to filter by',
      },
      escalationPolicyIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated escalation policy IDs to filter by',
      },
      userIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated user IDs to filter by',
      },
      serviceIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated service IDs to filter by',
      },
    },

    request: {
      url: (params) => {
        const queryParams = new URLSearchParams()
        if (params.scheduleIds) queryParams.set('filter[schedule_ids]', params.scheduleIds)
        if (params.escalationPolicyIds)
          queryParams.set('filter[escalation_policy_ids]', params.escalationPolicyIds)
        if (params.userIds) queryParams.set('filter[user_ids]', params.userIds)
        if (params.serviceIds) queryParams.set('filter[service_ids]', params.serviceIds)
        const qs = queryParams.toString()
        return `https://api.rootly.com/v1/oncalls${qs ? `?${qs}` : ''}`
      },
      method: 'GET',
      headers: (params) => ({
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: { onCalls: [], totalCount: 0 },
          error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
        }
      }

      const data = await response.json()
      const onCalls = (data.data || []).map((item: Record<string, unknown>) => {
        const attrs = (item.attributes || {}) as Record<string, unknown>
        return {
          id: item.id ?? null,
          userId: (attrs.user_id as string) ?? null,
          userName: (attrs.user_name as string) ?? null,
          scheduleId: (attrs.schedule_id as string) ?? null,
          scheduleName: (attrs.schedule_name as string) ?? null,
          escalationPolicyId: (attrs.escalation_policy_id as string) ?? null,
          startTime: (attrs.start_time as string) ?? null,
          endTime: (attrs.end_time as string) ?? null,
        }
      })

      return {
        success: true,
        output: {
          onCalls,
          totalCount: data.meta?.total_count ?? onCalls.length,
        },
      }
    },

    outputs: {
      onCalls: {
        type: 'array',
        description: 'List of on-call entries',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique on-call entry ID' },
            userId: { type: 'string', description: 'ID of the on-call user' },
            userName: { type: 'string', description: 'Name of the on-call user' },
            scheduleId: { type: 'string', description: 'ID of the associated schedule' },
            scheduleName: { type: 'string', description: 'Name of the associated schedule' },
            escalationPolicyId: {
              type: 'string',
              description: 'ID of the associated escalation policy',
            },
            startTime: { type: 'string', description: 'On-call start time' },
            endTime: { type: 'string', description: 'On-call end time' },
          },
        },
      },
      totalCount: {
        type: 'number',
        description: 'Total number of on-call entries returned',
      },
    },
  }
