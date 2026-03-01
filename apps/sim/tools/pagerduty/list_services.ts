import type {
  PagerDutyListServicesParams,
  PagerDutyListServicesResponse,
} from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const listServicesTool: ToolConfig<
  PagerDutyListServicesParams,
  PagerDutyListServicesResponse
> = {
  id: 'pagerduty_list_services',
  name: 'PagerDuty List Services',
  description: 'List services from PagerDuty with optional name filter.',
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
      description: 'Filter services by name',
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
      if (params.query) query.set('query', params.query)
      if (params.limit) query.set('limit', params.limit)
      const qs = query.toString()
      return `https://api.pagerduty.com/services${qs ? `?${qs}` : ''}`
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
        services: (data.services ?? []).map(
          (svc: Record<string, unknown> & { escalation_policy?: Record<string, unknown> }) => ({
            id: svc.id ?? null,
            name: svc.name ?? null,
            description: svc.description ?? null,
            status: svc.status ?? null,
            escalationPolicyName: svc.escalation_policy?.summary ?? null,
            escalationPolicyId: svc.escalation_policy?.id ?? null,
            createdAt: svc.created_at ?? null,
            htmlUrl: svc.html_url ?? null,
          })
        ),
        total: data.total ?? 0,
        more: data.more ?? false,
      },
    }
  },

  outputs: {
    services: {
      type: 'array',
      description: 'Array of services',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Service ID' },
          name: { type: 'string', description: 'Service name' },
          description: { type: 'string', description: 'Service description' },
          status: { type: 'string', description: 'Service status' },
          escalationPolicyName: { type: 'string', description: 'Escalation policy name' },
          escalationPolicyId: { type: 'string', description: 'Escalation policy ID' },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          htmlUrl: { type: 'string', description: 'PagerDuty web URL' },
        },
      },
    },
    total: {
      type: 'number',
      description: 'Total number of matching services',
    },
    more: {
      type: 'boolean',
      description: 'Whether more results are available',
    },
  },
}
