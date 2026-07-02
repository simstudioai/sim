import type { ToolConfig } from '@/tools/types'
import type { VercelListProjectsParams, VercelListProjectsResponse } from '@/tools/vercel/types'

export const vercelListProjectsTool: ToolConfig<
  VercelListProjectsParams,
  VercelListProjectsResponse
> = {
  id: 'vercel_list_projects',
  name: 'Vercel List Projects',
  description: 'List all projects in a Vercel team or account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search projects by name',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of projects to return',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Continuation token for pagination, taken from the previous response's pagination.next value. Query only projects updated after this timestamp or continuation token.",
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
    slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team slug to scope the request (alternative to teamId)',
    },
  },

  request: {
    url: (params: VercelListProjectsParams) => {
      const query = new URLSearchParams()
      if (params.search) query.set('search', params.search)
      if (params.limit) query.set('limit', String(params.limit))
      if (params.from) query.set('from', params.from.trim())
      if (params.teamId) query.set('teamId', params.teamId.trim())
      if (params.slug) query.set('slug', params.slug.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v10/projects${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelListProjectsParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const projects = (data.projects ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      framework: p.framework ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }))

    return {
      success: true,
      output: {
        projects,
        count: projects.length,
        hasMore: data.pagination?.next != null,
        nextFrom: data.pagination?.next != null ? String(data.pagination.next) : null,
      },
    }
  },

  outputs: {
    projects: {
      type: 'array',
      description: 'List of projects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Project ID' },
          name: { type: 'string', description: 'Project name' },
          framework: { type: 'string', description: 'Framework', optional: true },
          createdAt: { type: 'number', description: 'Creation timestamp' },
          updatedAt: { type: 'number', description: 'Last updated timestamp' },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of projects returned',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more projects are available',
    },
    nextFrom: {
      type: 'string',
      description: 'Continuation token to pass as `from` to fetch the next page',
      optional: true,
    },
  },
}
