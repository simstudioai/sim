import type { RootlyUpdateIncidentParams, RootlyUpdateIncidentResponse } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyUpdateIncidentTool: ToolConfig<
  RootlyUpdateIncidentParams,
  RootlyUpdateIncidentResponse
> = {
  id: 'rootly_update_incident',
  name: 'Rootly Update Incident',
  description: 'Update an existing incident in Rootly (status, severity, summary, etc.).',
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
      description: 'The ID of the incident to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated incident title',
    },
    summary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated incident summary',
    },
    severityId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated severity ID',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Updated status (in_triage, started, detected, acknowledged, mitigated, resolved, closed, cancelled, scheduled, in_progress, completed)',
    },
    kind: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Incident kind (normal, normal_sub, test, test_sub, example, example_sub, backfilled, scheduled, scheduled_sub)',
    },
    private: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set incident as private (cannot be undone)',
    },
    serviceIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated service IDs',
    },
    environmentIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated environment IDs',
    },
    groupIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated team/group IDs',
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
    mitigationMessage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'How was the incident mitigated?',
    },
    resolutionMessage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'How was the incident resolved?',
    },
    cancellationMessage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Why was the incident cancelled?',
    },
  },

  request: {
    url: (params) => `https://api.rootly.com/v1/incidents/${params.incidentId.trim()}`,
    method: 'PUT',
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
      if (params.mitigationMessage) attributes.mitigation_message = params.mitigationMessage
      if (params.resolutionMessage) attributes.resolution_message = params.resolutionMessage
      if (params.cancellationMessage) attributes.cancellation_message = params.cancellationMessage
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
      if (params.serviceIds) {
        attributes.service_ids = params.serviceIds.split(',').map((s: string) => s.trim())
      }
      if (params.environmentIds) {
        attributes.environment_ids = params.environmentIds.split(',').map((s: string) => s.trim())
      }
      if (params.groupIds) {
        attributes.group_ids = params.groupIds.split(',').map((s: string) => s.trim())
      }
      return { data: { type: 'incidents', id: params.incidentId.trim(), attributes } }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { incident: {} as RootlyUpdateIncidentResponse['output']['incident'] },
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
      description: 'The updated incident',
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
