import type {
  RootlyListActionItemsParams,
  RootlyListActionItemsResponse,
} from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyListActionItemsTool: ToolConfig<
  RootlyListActionItemsParams,
  RootlyListActionItemsResponse
> = {
  id: 'rootly_list_action_items',
  name: 'Rootly List Action Items',
  description: 'List action items for an incident in Rootly.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rootly API key',
    },
    incidentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the incident to list action items for',
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
      if (params.pageSize) queryParams.set('page[size]', String(params.pageSize))
      if (params.pageNumber) queryParams.set('page[number]', String(params.pageNumber))
      const qs = queryParams.toString()
      return `https://api.rootly.com/v1/incidents/${params.incidentId.trim()}/action_items${qs ? `?${qs}` : ''}`
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
        output: { actionItems: [], totalCount: 0 },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const actionItems = (data.data || []).map((item: Record<string, unknown>) => {
      const attrs = (item.attributes || {}) as Record<string, unknown>
      return {
        id: item.id ?? null,
        summary: (attrs.summary as string) ?? '',
        description: (attrs.description as string) ?? null,
        kind: (attrs.kind as string) ?? null,
        priority: (attrs.priority as string) ?? null,
        status: (attrs.status as string) ?? null,
        dueDate: (attrs.due_date as string) ?? null,
        createdAt: (attrs.created_at as string) ?? '',
        updatedAt: (attrs.updated_at as string) ?? '',
      }
    })

    return {
      success: true,
      output: {
        actionItems,
        totalCount: data.meta?.total_count ?? actionItems.length,
      },
    }
  },

  outputs: {
    actionItems: {
      type: 'array',
      description: 'List of action items',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique action item ID' },
          summary: { type: 'string', description: 'Action item title' },
          description: { type: 'string', description: 'Action item description' },
          kind: { type: 'string', description: 'Action item kind (task, follow_up)' },
          priority: { type: 'string', description: 'Priority level' },
          status: { type: 'string', description: 'Action item status' },
          dueDate: { type: 'string', description: 'Due date' },
          createdAt: { type: 'string', description: 'Creation date' },
          updatedAt: { type: 'string', description: 'Last update date' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of action items returned',
    },
  },
}
