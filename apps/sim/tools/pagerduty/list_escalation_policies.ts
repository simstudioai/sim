import type {
  PagerDutyListEscalationPoliciesParams,
  PagerDutyListEscalationPoliciesResponse,
} from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const listEscalationPoliciesTool: ToolConfig<
  PagerDutyListEscalationPoliciesParams,
  PagerDutyListEscalationPoliciesResponse
> = {
  id: 'pagerduty_list_escalation_policies',
  name: 'PagerDuty List Escalation Policies',
  description: 'List escalation policies from PagerDuty with an optional name filter.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PagerDuty REST API Key',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter escalation policies by name',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (max 100)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset to start pagination search results',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.query) query.set('query', params.query)
      if (params.limit) query.set('limit', params.limit)
      if (params.offset) query.set('offset', params.offset)
      const qs = query.toString()
      return `https://api.pagerduty.com/escalation_policies${qs ? `?${qs}` : ''}`
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

    return {
      success: true,
      output: {
        escalationPolicies: (data.escalation_policies ?? []).map((ep: Record<string, unknown>) => ({
          id: ep.id ?? null,
          name: ep.name ?? null,
          description: ep.description ?? null,
          numLoops: ep.num_loops ?? 0,
          onCallHandoffNotifications: ep.on_call_handoff_notifications ?? null,
          htmlUrl: ep.html_url ?? null,
        })),
        total: data.total ?? null,
        more: data.more ?? false,
        offset: data.offset ?? 0,
      },
    }
  },

  outputs: {
    escalationPolicies: {
      type: 'array',
      description: 'Array of escalation policies',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Escalation policy ID' },
          name: { type: 'string', description: 'Escalation policy name' },
          description: { type: 'string', description: 'Escalation policy description' },
          numLoops: { type: 'number', description: 'Number of times the policy repeats' },
          onCallHandoffNotifications: {
            type: 'string',
            description: 'Handoff notification setting (if_has_services or always)',
          },
          htmlUrl: { type: 'string', description: 'PagerDuty web URL' },
        },
      },
    },
    total: {
      type: 'number',
      description:
        'Total number of matching escalation policies (null unless explicitly requested by PagerDuty)',
      optional: true,
    },
    more: {
      type: 'boolean',
      description: 'Whether more results are available',
    },
    offset: {
      type: 'number',
      description: 'Offset used for this page of results',
    },
  },
}
