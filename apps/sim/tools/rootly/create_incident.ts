import type { RootlyCreateIncidentParams, RootlyCreateIncidentResponse } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyCreateIncidentTool: ToolConfig<
  RootlyCreateIncidentParams,
  RootlyCreateIncidentResponse
> = {
  id: 'rootly_create_incident',
  name: 'Rootly Create Incident',
  description: 'Create a new incident in Rootly with optional severity, services, and teams.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rootly API key',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The title of the incident (auto-generated if not provided)',
    },
    summary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A summary of the incident',
    },
    severityId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Severity ID to attach to the incident',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Incident status (in_triage, started, detected, acknowledged, mitigated, resolved, closed, cancelled, scheduled, in_progress, completed)',
    },
    kind: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Incident kind (normal, normal_sub, test, test_sub, example, example_sub, backfilled, scheduled, scheduled_sub)',
    },
    serviceIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated service IDs to attach',
    },
    environmentIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated environment IDs to attach',
    },
    groupIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated team/group IDs to attach',
    },
    incidentTypeIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated incident type IDs to attach',
    },
    functionalityIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated functionality IDs to attach',
    },
    labels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Labels as JSON object, e.g. {"platform":"osx","version":"1.29"}',
    },
    private: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Create as a private incident (cannot be undone)',
    },
  },

  request: {
    url: 'https://api.rootly.com/v1/incidents',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const attributes: Record<string, unknown> = {}
      if (params.title) attributes.title = params.title
      if (params.summary) attributes.summary = params.summary
      if (params.severityId) attributes.severity_id = params.severityId
      if (params.status) attributes.status = params.status
      if (params.kind) attributes.kind = params.kind
      if (params.private !== undefined) attributes.private = params.private
      if (params.serviceIds) {
        attributes.service_ids = params.serviceIds.split(',').map((s: string) => s.trim())
      }
      if (params.environmentIds) {
        attributes.environment_ids = params.environmentIds.split(',').map((s: string) => s.trim())
      }
      if (params.groupIds) {
        attributes.group_ids = params.groupIds.split(',').map((s: string) => s.trim())
      }
      if (params.incidentTypeIds) {
        attributes.incident_type_ids = params.incidentTypeIds
          .split(',')
          .map((s: string) => s.trim())
      }
      if (params.functionalityIds) {
        attributes.functionality_ids = params.functionalityIds
          .split(',')
          .map((s: string) => s.trim())
      }
      if (params.labels) {
        try {
          attributes.labels = JSON.parse(params.labels)
        } catch {
          attributes.labels = params.labels
        }
      }
      return { data: { type: 'incidents', attributes } }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMsg =
        errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`
      return {
        success: false,
        output: { incident: {} as RootlyCreateIncidentResponse['output']['incident'] },
        error: errorMsg,
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
      description: 'The created incident',
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
