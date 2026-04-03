import type { RootlyListSchedulesParams, RootlyListSchedulesResponse } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyListSchedulesTool: ToolConfig<
  RootlyListSchedulesParams,
  RootlyListSchedulesResponse
> = {
  id: 'rootly_list_schedules',
  name: 'Rootly List Schedules',
  description: 'List on-call schedules from Rootly with optional search filtering.',
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
      description: 'Search term to filter schedules',
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
      return `https://api.rootly.com/v1/schedules${qs ? `?${qs}` : ''}`
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
        output: { schedules: [], totalCount: 0 },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const schedules = (data.data || []).map((item: Record<string, unknown>) => {
      const attrs = (item.attributes || {}) as Record<string, unknown>
      return {
        id: item.id ?? null,
        name: (attrs.name as string) ?? '',
        description: (attrs.description as string) ?? null,
        allTimeCoverage: (attrs.all_time_coverage as boolean) ?? null,
        createdAt: (attrs.created_at as string) ?? '',
        updatedAt: (attrs.updated_at as string) ?? '',
      }
    })

    return {
      success: true,
      output: {
        schedules,
        totalCount: data.meta?.total_count ?? schedules.length,
      },
    }
  },

  outputs: {
    schedules: {
      type: 'array',
      description: 'List of schedules',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique schedule ID' },
          name: { type: 'string', description: 'Schedule name' },
          description: { type: 'string', description: 'Schedule description' },
          allTimeCoverage: {
            type: 'boolean',
            description: 'Whether schedule provides 24/7 coverage',
          },
          createdAt: { type: 'string', description: 'Creation date' },
          updatedAt: { type: 'string', description: 'Last update date' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of schedules returned',
    },
  },
}
