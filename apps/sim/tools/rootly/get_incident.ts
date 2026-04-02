import type { RootlyGetIncidentParams, RootlyGetIncidentResponse } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyGetIncidentTool: ToolConfig<RootlyGetIncidentParams, RootlyGetIncidentResponse> =
  {
    id: 'rootly_get_incident',
    name: 'Rootly Get Incident',
    description: 'Retrieve a single incident by ID from Rootly.',
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
        description: 'The ID of the incident to retrieve',
      },
    },

    request: {
      url: (params) => `https://api.rootly.com/v1/incidents/${params.incidentId.trim()}`,
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
          output: { incident: {} as RootlyGetIncidentResponse['output']['incident'] },
          error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
        }
      }

      const data = await response.json()
      const attrs = data.data?.attributes || {}
      return {
        success: true,
        output: {
          incident: {
            id: data.data?.id ?? null,
            sequentialId: attrs.sequential_id ?? null,
            title: attrs.title ?? '',
            slug: attrs.slug ?? null,
            kind: attrs.kind ?? null,
            summary: attrs.summary ?? null,
            status: attrs.status ?? null,
            private: attrs.private ?? false,
            url: attrs.url ?? null,
            shortUrl: attrs.short_url ?? null,
            severityName: attrs.severity?.data?.attributes?.name ?? null,
            severityId: attrs.severity?.data?.id ?? null,
            createdAt: attrs.created_at ?? '',
            updatedAt: attrs.updated_at ?? '',
            startedAt: attrs.started_at ?? null,
            mitigatedAt: attrs.mitigated_at ?? null,
            resolvedAt: attrs.resolved_at ?? null,
            closedAt: attrs.closed_at ?? null,
          },
        },
      }
    },

    outputs: {
      incident: {
        type: 'object',
        description: 'The incident details',
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
  }
