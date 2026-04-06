import type { RootlyListAlertsParams, RootlyListAlertsResponse } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyListAlertsTool: ToolConfig<RootlyListAlertsParams, RootlyListAlertsResponse> = {
  id: 'rootly_list_alerts',
  name: 'Rootly List Alerts',
  description: 'List alerts from Rootly with optional filtering by status, source, and services.',
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
      description: 'Filter by status (open, triggered, acknowledged, resolved)',
    },
    source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by source (e.g., api, datadog, pagerduty)',
    },
    services: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by service slugs (comma-separated)',
    },
    environments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by environment slugs (comma-separated)',
    },
    groups: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by team/group slugs (comma-separated)',
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
      if (params.source) queryParams.set('filter[source]', params.source)
      if (params.services) queryParams.set('filter[services]', params.services)
      if (params.environments) queryParams.set('filter[environments]', params.environments)
      if (params.groups) queryParams.set('filter[groups]', params.groups)
      if (params.pageSize) queryParams.set('page[size]', String(params.pageSize))
      if (params.pageNumber) queryParams.set('page[number]', String(params.pageNumber))
      const qs = queryParams.toString()
      return `https://api.rootly.com/v1/alerts${qs ? `?${qs}` : ''}`
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
        output: { alerts: [], totalCount: 0 },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const alerts = (data.data || []).map((item: Record<string, unknown>) => {
      const attrs = (item.attributes || {}) as Record<string, unknown>
      return {
        id: item.id ?? null,
        shortId: (attrs.short_id as string) ?? null,
        summary: (attrs.summary as string) ?? '',
        description: (attrs.description as string) ?? null,
        source: (attrs.source as string) ?? null,
        status: (attrs.status as string) ?? null,
        externalId: (attrs.external_id as string) ?? null,
        externalUrl: (attrs.external_url as string) ?? null,
        deduplicationKey: (attrs.deduplication_key as string) ?? null,
        createdAt: (attrs.created_at as string) ?? '',
        updatedAt: (attrs.updated_at as string) ?? '',
        startedAt: (attrs.started_at as string) ?? null,
        endedAt: (attrs.ended_at as string) ?? null,
      }
    })

    return {
      success: true,
      output: {
        alerts,
        totalCount: data.meta?.total_count ?? alerts.length,
      },
    }
  },

  outputs: {
    alerts: {
      type: 'array',
      description: 'List of alerts',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique alert ID' },
          shortId: { type: 'string', description: 'Short alert ID' },
          summary: { type: 'string', description: 'Alert summary' },
          description: { type: 'string', description: 'Alert description' },
          source: { type: 'string', description: 'Alert source' },
          status: { type: 'string', description: 'Alert status' },
          externalId: { type: 'string', description: 'External ID' },
          externalUrl: { type: 'string', description: 'External URL' },
          deduplicationKey: { type: 'string', description: 'Deduplication key' },
          createdAt: { type: 'string', description: 'Creation date' },
          updatedAt: { type: 'string', description: 'Last update date' },
          startedAt: { type: 'string', description: 'Start date' },
          endedAt: { type: 'string', description: 'End date' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of alerts returned',
    },
  },
}
