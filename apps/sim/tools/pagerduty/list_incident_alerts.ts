import type {
  PagerDutyListIncidentAlertsParams,
  PagerDutyListIncidentAlertsResponse,
} from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const listIncidentAlertsTool: ToolConfig<
  PagerDutyListIncidentAlertsParams,
  PagerDutyListIncidentAlertsResponse
> = {
  id: 'pagerduty_list_incident_alerts',
  name: 'PagerDuty List Incident Alerts',
  description: 'List the individual alerts attached to a PagerDuty incident.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PagerDuty REST API Key',
    },
    incidentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the incident whose alerts to list',
    },
    statuses: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated statuses to filter (triggered, resolved)',
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
      if (params.limit) query.set('limit', params.limit)
      if (params.offset) query.set('offset', params.offset)
      const qs = query.toString()
      return `https://api.pagerduty.com/incidents/${params.incidentId.trim()}/alerts${qs ? `?${qs}` : ''}`
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
        alerts: (data.alerts ?? []).map(
          (alert: Record<string, unknown> & { service?: Record<string, unknown> }) => ({
            id: alert.id ?? null,
            summary: alert.summary ?? null,
            status: alert.status ?? null,
            severity: alert.severity ?? null,
            createdAt: alert.created_at ?? null,
            alertKey: alert.alert_key ?? null,
            serviceName: alert.service?.summary ?? null,
            serviceId: alert.service?.id ?? null,
            htmlUrl: alert.html_url ?? null,
          })
        ),
        total: data.total ?? null,
        more: data.more ?? false,
        offset: data.offset ?? 0,
      },
    }
  },

  outputs: {
    alerts: {
      type: 'array',
      description: 'Array of alerts attached to the incident',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Alert ID' },
          summary: { type: 'string', description: 'Alert summary' },
          status: { type: 'string', description: 'Alert status' },
          severity: { type: 'string', description: 'Alert severity' },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          alertKey: { type: 'string', description: 'De-duplication key' },
          serviceName: { type: 'string', description: 'Service name' },
          serviceId: { type: 'string', description: 'Service ID' },
          htmlUrl: { type: 'string', description: 'PagerDuty web URL' },
        },
      },
    },
    total: {
      type: 'number',
      description:
        'Total number of matching alerts (null unless explicitly requested by PagerDuty)',
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
