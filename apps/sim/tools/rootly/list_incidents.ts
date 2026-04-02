import type { RootlyListIncidentsParams, RootlyListIncidentsResponse } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyListIncidentsTool: ToolConfig<
  RootlyListIncidentsParams,
  RootlyListIncidentsResponse
> = {
  id: 'rootly_list_incidents',
  name: 'Rootly List Incidents',
  description: 'List incidents from Rootly with optional filtering by status, severity, and more.',
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
      description:
        'Filter by status (in_triage, started, detected, acknowledged, mitigated, resolved, closed, cancelled, scheduled, in_progress, completed)',
    },
    severity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by severity slug',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter incidents',
    },
    services: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by service slugs (comma-separated)',
    },
    teams: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by team slugs (comma-separated)',
    },
    environments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by environment slugs (comma-separated)',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order (e.g., -created_at, created_at, -started_at)',
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
      if (params.severity) queryParams.set('filter[severity]', params.severity)
      if (params.search) queryParams.set('filter[search]', params.search)
      if (params.services) queryParams.set('filter[services]', params.services)
      if (params.teams) queryParams.set('filter[teams]', params.teams)
      if (params.environments) queryParams.set('filter[environments]', params.environments)
      if (params.sort) queryParams.set('sort', params.sort)
      if (params.pageSize) queryParams.set('page[size]', String(params.pageSize))
      if (params.pageNumber) queryParams.set('page[number]', String(params.pageNumber))
      const qs = queryParams.toString()
      return `https://api.rootly.com/v1/incidents${qs ? `?${qs}` : ''}`
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
        output: { incidents: [], totalCount: 0 },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const incidents = (data.data || []).map((item: Record<string, unknown>) => {
      const attrs = (item.attributes || {}) as Record<string, unknown>
      const severity = attrs.severity as Record<string, unknown> | undefined
      const severityData = severity?.data as Record<string, unknown> | undefined
      const severityAttrs = severityData?.attributes as Record<string, unknown> | undefined
      return {
        id: item.id ?? null,
        sequentialId: (attrs.sequential_id as number) ?? null,
        title: (attrs.title as string) ?? '',
        slug: (attrs.slug as string) ?? null,
        kind: (attrs.kind as string) ?? null,
        summary: (attrs.summary as string) ?? null,
        status: (attrs.status as string) ?? null,
        private: (attrs.private as boolean) ?? false,
        url: (attrs.url as string) ?? null,
        shortUrl: (attrs.short_url as string) ?? null,
        severityName: (severityAttrs?.name as string) ?? null,
        severityId: (severityData?.id as string) ?? null,
        createdAt: (attrs.created_at as string) ?? '',
        updatedAt: (attrs.updated_at as string) ?? '',
        startedAt: (attrs.started_at as string) ?? null,
        mitigatedAt: (attrs.mitigated_at as string) ?? null,
        resolvedAt: (attrs.resolved_at as string) ?? null,
        closedAt: (attrs.closed_at as string) ?? null,
      }
    })

    return {
      success: true,
      output: {
        incidents,
        totalCount: data.meta?.total_count ?? incidents.length,
      },
    }
  },

  outputs: {
    incidents: {
      type: 'array',
      description: 'List of incidents',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique incident ID' },
          sequentialId: { type: 'number', description: 'Sequential incident number' },
          title: { type: 'string', description: 'Incident title' },
          slug: { type: 'string', description: 'Incident slug' },
          kind: { type: 'string', description: 'Incident kind' },
          summary: { type: 'string', description: 'Incident summary' },
          status: { type: 'string', description: 'Incident status' },
          private: { type: 'boolean', description: 'Whether the incident is private' },
          url: { type: 'string', description: 'URL to the incident' },
          shortUrl: { type: 'string', description: 'Short URL to the incident' },
          severityName: { type: 'string', description: 'Severity name' },
          severityId: { type: 'string', description: 'Severity ID' },
          createdAt: { type: 'string', description: 'Creation date' },
          updatedAt: { type: 'string', description: 'Last update date' },
          startedAt: { type: 'string', description: 'Start date' },
          mitigatedAt: { type: 'string', description: 'Mitigation date' },
          resolvedAt: { type: 'string', description: 'Resolution date' },
          closedAt: { type: 'string', description: 'Closed date' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of incidents returned',
    },
  },
}
