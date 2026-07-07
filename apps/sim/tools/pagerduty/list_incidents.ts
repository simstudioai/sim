import type {
  PagerDutyListIncidentsParams,
  PagerDutyListIncidentsResponse,
} from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const listIncidentsTool: ToolConfig<
  PagerDutyListIncidentsParams,
  PagerDutyListIncidentsResponse
> = {
  id: 'pagerduty_list_incidents',
  name: 'PagerDuty List Incidents',
  description: 'List incidents from PagerDuty with optional filters.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PagerDuty REST API Key',
    },
    statuses: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated statuses to filter (triggered, acknowledged, resolved)',
    },
    urgencies: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated urgencies to filter (high, low)',
    },
    serviceIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated service IDs to filter',
    },
    since: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date filter (ISO 8601 format)',
    },
    until: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date filter (ISO 8601 format)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field (e.g., created_at:desc)',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (max 100)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset to start pagination search results',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.statuses) {
        for (const s of params.statuses.split(',')) {
          query.append('statuses[]', s.trim())
        }
      }
      if (params.urgencies) {
        for (const u of params.urgencies.split(',')) {
          query.append('urgencies[]', u.trim())
        }
      }
      if (params.serviceIds) {
        for (const id of params.serviceIds.split(',')) {
          query.append('service_ids[]', id.trim())
        }
      }
      if (params.since) query.set('since', params.since)
      if (params.until) query.set('until', params.until)
      if (params.sortBy) query.set('sort_by', params.sortBy)
      if (params.limit) query.set('limit', params.limit)
      if (params.offset) query.set('offset', params.offset)
      query.append('include[]', 'services')
      const qs = query.toString()
      return `https://api.pagerduty.com/incidents${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Token token=${params.apiKey}`,
      Accept: 'application/vnd.pagerduty+json;version=2',
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || `PagerDuty API error: ${response.status}`)
    }

    return {
      success: true,
      output: {
        incidents: (data.incidents ?? []).map(
          (
            inc: Record<string, unknown> & {
              service?: Record<string, unknown>
              assignments?: Array<Record<string, unknown> & { assignee?: Record<string, unknown> }>
              escalation_policy?: Record<string, unknown>
            }
          ) => ({
            id: inc.id ?? null,
            incidentNumber: inc.incident_number ?? null,
            title: inc.title ?? null,
            status: inc.status ?? null,
            urgency: inc.urgency ?? null,
            createdAt: inc.created_at ?? null,
            updatedAt: inc.updated_at ?? null,
            serviceName: inc.service?.summary ?? null,
            serviceId: inc.service?.id ?? null,
            assigneeName: inc.assignments?.[0]?.assignee?.summary ?? null,
            assigneeId: inc.assignments?.[0]?.assignee?.id ?? null,
            escalationPolicyName: inc.escalation_policy?.summary ?? null,
            htmlUrl: inc.html_url ?? null,
          })
        ),
        total: data.total ?? null,
        more: data.more ?? false,
        offset: data.offset ?? 0,
      },
    }
  },

  outputs: {
    incidents: {
      type: 'array',
      description: 'Array of incidents',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Incident ID' },
          incidentNumber: { type: 'number', description: 'Incident number' },
          title: { type: 'string', description: 'Incident title' },
          status: { type: 'string', description: 'Incident status' },
          urgency: { type: 'string', description: 'Incident urgency' },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          updatedAt: { type: 'string', description: 'Last updated timestamp' },
          serviceName: { type: 'string', description: 'Service name' },
          serviceId: { type: 'string', description: 'Service ID' },
          assigneeName: { type: 'string', description: 'Assignee name' },
          assigneeId: { type: 'string', description: 'Assignee ID' },
          escalationPolicyName: { type: 'string', description: 'Escalation policy name' },
          htmlUrl: { type: 'string', description: 'PagerDuty web URL' },
        },
      },
    },
    total: {
      type: 'number',
      description:
        'Total number of matching incidents (null unless explicitly requested by PagerDuty)',
      optional: true,
    },
    more: {
      type: 'boolean',
      description: 'Whether more results are available',
    },
    offset: {
      type: 'number',
      description: 'Offset used for this page of results',
    },
  },
}
