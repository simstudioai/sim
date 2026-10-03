import type {
  IncidentioIncidentAlertsListParams,
  IncidentioIncidentAlertsListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

/** incident.io requires a page size on this endpoint, so fall back to its documented default. */
const DEFAULT_PAGE_SIZE = 25

export const incidentAlertsListTool: ToolConfig<
  IncidentioIncidentAlertsListParams,
  IncidentioIncidentAlertsListResponse
> = {
  id: 'incidentio_incident_alerts_list',
  name: 'List Incident Alerts',
  description:
    'List the connections between incidents and alerts in incident.io — which alerts triggered an incident, or which incident an alert was attached to',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (e.g., 10, 25, 50). Default: 25',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor to fetch the next page of results (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    incident_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return alerts attached to this incident (e.g., "01FDAG4SAP5TYPT98WGR2N7W91")',
    },
    alert_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return connections for this alert (e.g., "01GW2G3V0S59R238FAHPDS1R66")',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.incident.io/v2/incident_alerts')
      url.searchParams.set(
        'page_size',
        String(params.page_size && params.page_size > 0 ? params.page_size : DEFAULT_PAGE_SIZE)
      )

      if (params.after) url.searchParams.set('after', params.after)
      if (params.incident_id) url.searchParams.set('incident_id', params.incident_id.trim())
      if (params.alert_id) url.searchParams.set('alert_id', params.alert_id.trim())

      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        incident_alerts: data.incident_alerts ?? [],
        pagination_meta: data.pagination_meta,
      },
    }
  },

  outputs: {
    incident_alerts: {
      type: 'array',
      description: 'List of incident-to-alert connections',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID of this incident alert connection' },
          alert_route_id: {
            type: 'string',
            description: 'ID of the alert route that created this connection',
            optional: true,
          },
          alert: {
            type: 'object',
            description: 'The connected alert',
            properties: {
              id: { type: 'string', description: 'Alert ID' },
              title: { type: 'string', description: 'Alert title' },
              status: { type: 'string', description: 'Alert status (firing, resolved)' },
              alert_source_id: {
                type: 'string',
                description: 'ID of the alert source this alert fired on',
              },
              deduplication_key: {
                type: 'string',
                description: 'Key that uniquely references this alert from its source',
              },
              description: { type: 'string', description: 'Alert description', optional: true },
              source_url: {
                type: 'string',
                description: 'Link to the alert in the upstream system',
                optional: true,
              },
              resolved_at: {
                type: 'string',
                description: 'When this alert was resolved',
                optional: true,
              },
              created_at: { type: 'string', description: 'When this alert was created' },
              updated_at: { type: 'string', description: 'When this alert was last updated' },
            },
          },
          incident: {
            type: 'object',
            description: 'The incident the alert is attached to',
            properties: {
              id: { type: 'string', description: 'Incident ID' },
              name: { type: 'string', description: 'Incident name' },
              reference: { type: 'string', description: 'Incident reference (e.g., INC-123)' },
              external_id: { type: 'number', description: 'External incident identifier' },
              status_category: { type: 'string', description: 'Category of the incident status' },
              visibility: { type: 'string', description: 'Incident visibility (public, private)' },
              summary: { type: 'string', description: 'Incident summary', optional: true },
            },
          },
        },
      },
    },
    pagination_meta: {
      type: 'object',
      description: 'Pagination metadata',
      optional: true,
      properties: {
        after: { type: 'string', description: 'Cursor for next page', optional: true },
        page_size: { type: 'number', description: 'Number of results per page' },
      },
    },
  },
}
