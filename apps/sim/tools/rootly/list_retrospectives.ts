import type {
  RootlyListRetrospectivesParams,
  RootlyListRetrospectivesResponse,
} from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyListRetrospectivesTool: ToolConfig<
  RootlyListRetrospectivesParams,
  RootlyListRetrospectivesResponse
> = {
  id: 'rootly_list_retrospectives',
  name: 'Rootly List Retrospectives',
  description: 'List incident retrospectives (post-mortems) from Rootly.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rootly API key',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by status (draft, published)',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter retrospectives',
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
      if (params.status) queryParams.set('filter[status]', params.status)
      if (params.search) queryParams.set('filter[search]', params.search)
      if (params.pageSize) queryParams.set('page[size]', String(params.pageSize))
      if (params.pageNumber) queryParams.set('page[number]', String(params.pageNumber))
      const qs = queryParams.toString()
      return `https://api.rootly.com/v1/post_mortems${qs ? `?${qs}` : ''}`
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
        output: { retrospectives: [], totalCount: 0 },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const retrospectives = (data.data || []).map((item: Record<string, unknown>) => {
      const attrs = (item.attributes || {}) as Record<string, unknown>
      return {
        id: item.id ?? null,
        title: (attrs.title as string) ?? '',
        status: (attrs.status as string) ?? null,
        url: (attrs.url as string) ?? null,
        startedAt: (attrs.started_at as string) ?? null,
        mitigatedAt: (attrs.mitigated_at as string) ?? null,
        resolvedAt: (attrs.resolved_at as string) ?? null,
        createdAt: (attrs.created_at as string) ?? '',
        updatedAt: (attrs.updated_at as string) ?? '',
      }
    })

    return {
      success: true,
      output: {
        retrospectives,
        totalCount: data.meta?.total_count ?? retrospectives.length,
      },
    }
  },

  outputs: {
    retrospectives: {
      type: 'array',
      description: 'List of retrospectives',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique retrospective ID' },
          title: { type: 'string', description: 'Retrospective title' },
          status: { type: 'string', description: 'Status (draft or published)' },
          url: { type: 'string', description: 'URL to the retrospective' },
          startedAt: { type: 'string', description: 'Incident start date' },
          mitigatedAt: { type: 'string', description: 'Mitigation date' },
          resolvedAt: { type: 'string', description: 'Resolution date' },
          createdAt: { type: 'string', description: 'Creation date' },
          updatedAt: { type: 'string', description: 'Last update date' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of retrospectives returned',
    },
  },
}
