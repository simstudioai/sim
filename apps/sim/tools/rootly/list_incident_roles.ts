import type {
  RootlyListIncidentRolesParams,
  RootlyListIncidentRolesResponse,
} from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyListIncidentRolesTool: ToolConfig<
  RootlyListIncidentRolesParams,
  RootlyListIncidentRolesResponse
> = {
  id: 'rootly_list_incident_roles',
  name: 'Rootly List Incident Roles',
  description: 'List incident roles configured in Rootly (e.g. commander, scribe).',
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
      description: 'Search term to filter incident roles',
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
      return `https://api.rootly.com/v1/incident_roles${qs ? `?${qs}` : ''}`
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
        output: { incidentRoles: [], totalCount: 0 },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const incidentRoles = (data.data || []).map((item: Record<string, unknown>) => {
      const attrs = (item.attributes || {}) as Record<string, unknown>
      return {
        id: item.id ?? null,
        name: (attrs.name as string) ?? '',
        slug: (attrs.slug as string) ?? null,
        summary: (attrs.summary as string) ?? null,
        description: (attrs.description as string) ?? null,
        position: (attrs.position as number) ?? null,
        optional: (attrs.optional as boolean) ?? null,
        enabled: (attrs.enabled as boolean) ?? null,
        createdAt: (attrs.created_at as string) ?? '',
        updatedAt: (attrs.updated_at as string) ?? '',
      }
    })

    return {
      success: true,
      output: {
        incidentRoles,
        totalCount: data.meta?.total_count ?? incidentRoles.length,
      },
    }
  },

  outputs: {
    incidentRoles: {
      type: 'array',
      description: 'List of incident roles',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique incident role ID' },
          name: { type: 'string', description: 'Role name' },
          slug: { type: 'string', description: 'Role slug' },
          summary: { type: 'string', description: 'Role summary' },
          description: { type: 'string', description: 'Role description' },
          position: { type: 'number', description: 'Display position' },
          optional: { type: 'boolean', description: 'Whether the role is optional' },
          enabled: { type: 'boolean', description: 'Whether the role is enabled' },
          createdAt: { type: 'string', description: 'Creation date' },
          updatedAt: { type: 'string', description: 'Last update date' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of incident roles returned',
    },
  },
}
