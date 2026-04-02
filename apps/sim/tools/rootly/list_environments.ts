import type {
  RootlyListEnvironmentsParams,
  RootlyListEnvironmentsResponse,
} from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyListEnvironmentsTool: ToolConfig<
  RootlyListEnvironmentsParams,
  RootlyListEnvironmentsResponse
> = {
  id: 'rootly_list_environments',
  name: 'Rootly List Environments',
  description: 'List environments configured in Rootly.',
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
      description: 'Search term to filter environments',
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
      return `https://api.rootly.com/v1/environments${qs ? `?${qs}` : ''}`
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
        output: { environments: [], totalCount: 0 },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const environments = (data.data || []).map((item: Record<string, unknown>) => {
      const attrs = (item.attributes || {}) as Record<string, unknown>
      return {
        id: item.id ?? null,
        name: (attrs.name as string) ?? '',
        slug: (attrs.slug as string) ?? null,
        description: (attrs.description as string) ?? null,
        color: (attrs.color as string) ?? null,
        createdAt: (attrs.created_at as string) ?? '',
        updatedAt: (attrs.updated_at as string) ?? '',
      }
    })

    return {
      success: true,
      output: {
        environments,
        totalCount: data.meta?.total_count ?? environments.length,
      },
    }
  },

  outputs: {
    environments: {
      type: 'array',
      description: 'List of environments',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique environment ID' },
          name: { type: 'string', description: 'Environment name' },
          slug: { type: 'string', description: 'Environment slug' },
          description: { type: 'string', description: 'Environment description' },
          color: { type: 'string', description: 'Environment color' },
          createdAt: { type: 'string', description: 'Creation date' },
          updatedAt: { type: 'string', description: 'Last update date' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of environments returned',
    },
  },
}
