import type {
  RootlyListEscalationPoliciesParams,
  RootlyListEscalationPoliciesResponse,
} from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyListEscalationPoliciesTool: ToolConfig<
  RootlyListEscalationPoliciesParams,
  RootlyListEscalationPoliciesResponse
> = {
  id: 'rootly_list_escalation_policies',
  name: 'Rootly List Escalation Policies',
  description: 'List escalation policies from Rootly with optional search filtering.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rootly API key',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter escalation policies',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of items per page (default: 20)',
    },
    pageNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.search) queryParams.set('filter[search]', params.search)
      if (params.pageSize) queryParams.set('page[size]', String(params.pageSize))
      if (params.pageNumber) queryParams.set('page[number]', String(params.pageNumber))
      const qs = queryParams.toString()
      return `https://api.rootly.com/v1/escalation_policies${qs ? `?${qs}` : ''}`
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
        output: { escalationPolicies: [], totalCount: 0 },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const escalationPolicies = (data.data || []).map((item: Record<string, unknown>) => {
      const attrs = (item.attributes || {}) as Record<string, unknown>
      return {
        id: item.id ?? null,
        name: (attrs.name as string) ?? '',
        description: (attrs.description as string) ?? null,
        repeatCount: (attrs.repeat_count as number) ?? null,
        groupIds: (attrs.group_ids as string[]) ?? null,
        serviceIds: (attrs.service_ids as string[]) ?? null,
        createdAt: (attrs.created_at as string) ?? '',
        updatedAt: (attrs.updated_at as string) ?? '',
      }
    })

    return {
      success: true,
      output: {
        escalationPolicies,
        totalCount: data.meta?.total_count ?? escalationPolicies.length,
      },
    }
  },

  outputs: {
    escalationPolicies: {
      type: 'array',
      description: 'List of escalation policies',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique escalation policy ID' },
          name: { type: 'string', description: 'Escalation policy name' },
          description: { type: 'string', description: 'Escalation policy description' },
          repeatCount: { type: 'number', description: 'Number of times to repeat escalation' },
          groupIds: { type: 'array', description: 'Associated group IDs' },
          serviceIds: { type: 'array', description: 'Associated service IDs' },
          createdAt: { type: 'string', description: 'Creation date' },
          updatedAt: { type: 'string', description: 'Last update date' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of escalation policies returned',
    },
  },
}
