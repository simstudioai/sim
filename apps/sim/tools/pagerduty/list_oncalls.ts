import type {
  PagerDutyListOncallsParams,
  PagerDutyListOncallsResponse,
} from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const listOncallsTool: ToolConfig<PagerDutyListOncallsParams, PagerDutyListOncallsResponse> =
  {
    id: 'pagerduty_list_oncalls',
    name: 'PagerDuty List On-Calls',
    description: 'List current on-call entries from PagerDuty.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PagerDuty REST API Key',
      },
      escalationPolicyIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated escalation policy IDs to filter',
      },
      scheduleIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated schedule IDs to filter',
      },
      since: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Start time filter (ISO 8601 format)',
      },
      until: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'End time filter (ISO 8601 format)',
      },
      limit: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of results (max 100)',
      },
    },

    request: {
      url: (params) => {
        const query = new URLSearchParams()
        if (params.escalationPolicyIds) {
          for (const id of params.escalationPolicyIds.split(',')) {
            query.append('escalation_policy_ids[]', id.trim())
          }
        }
        if (params.scheduleIds) {
          for (const id of params.scheduleIds.split(',')) {
            query.append('schedule_ids[]', id.trim())
          }
        }
        if (params.since) query.set('since', params.since)
        if (params.until) query.set('until', params.until)
        if (params.limit) query.set('limit', params.limit)
        const qs = query.toString()
        return `https://api.pagerduty.com/oncalls${qs ? `?${qs}` : ''}`
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Token token=${params.apiKey}`,
        Accept: 'application/vnd.pagerduty+json;version=2',
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || `PagerDuty API error: ${response.status}`)
      }

      const oncalls = (data.oncalls ?? []).map(
        (
          oc: Record<string, unknown> & {
            user?: Record<string, unknown>
            escalation_policy?: Record<string, unknown>
            schedule?: Record<string, unknown>
          }
        ) => ({
          userName: oc.user?.summary ?? null,
          userId: oc.user?.id ?? null,
          escalationLevel: oc.escalation_level ?? 0,
          escalationPolicyName: oc.escalation_policy?.summary ?? null,
          escalationPolicyId: oc.escalation_policy?.id ?? null,
          scheduleName: oc.schedule?.summary ?? null,
          scheduleId: oc.schedule?.id ?? null,
          start: oc.start ?? null,
          end: oc.end ?? null,
        })
      )

      return {
        success: true,
        output: {
          oncalls,
          total: data.total ?? oncalls.length,
          more: data.more ?? false,
        },
      }
    },

    outputs: {
      oncalls: {
        type: 'array',
        description: 'Array of on-call entries',
        items: {
          type: 'object',
          properties: {
            userName: { type: 'string', description: 'On-call user name' },
            userId: { type: 'string', description: 'On-call user ID' },
            escalationLevel: { type: 'number', description: 'Escalation level' },
            escalationPolicyName: { type: 'string', description: 'Escalation policy name' },
            escalationPolicyId: { type: 'string', description: 'Escalation policy ID' },
            scheduleName: { type: 'string', description: 'Schedule name' },
            scheduleId: { type: 'string', description: 'Schedule ID' },
            start: { type: 'string', description: 'On-call start time' },
            end: { type: 'string', description: 'On-call end time' },
          },
        },
      },
      total: {
        type: 'number',
        description: 'Total number of matching on-call entries',
      },
      more: {
        type: 'boolean',
        description: 'Whether more results are available',
      },
    },
  }
