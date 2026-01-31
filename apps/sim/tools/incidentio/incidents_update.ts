import type {
  IncidentioIncidentsUpdateParams,
  IncidentioIncidentsUpdateResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const incidentsUpdateTool: ToolConfig<
  IncidentioIncidentsUpdateParams,
  IncidentioIncidentsUpdateResponse
> = {
  id: 'incidentio_incidents_update',
  name: 'incident.io Incidents Update',
  description:
    'Update an existing incident in incident.io. Can update name, summary, severity, status, or type.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the incident to update (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated name of the incident (e.g., "Database connection issues")',
    },
    summary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Updated summary of the incident (e.g., "Intermittent connection failures to primary database")',
    },
    severity_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated severity ID for the incident (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    incident_status_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated status ID for the incident (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    incident_type_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated incident type ID',
    },
    notify_incident_channel: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to notify the incident channel about this update',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/incidents/${params.id}/actions/edit`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      // Create incident object
      const incident: Record<string, any> = {}

      if (params.name) incident.name = params.name
      if (params.summary) incident.summary = params.summary
      if (params.severity_id) incident.severity_id = params.severity_id
      if (params.incident_status_id) incident.incident_status_id = params.incident_status_id
      if (params.incident_type_id) incident.incident_type_id = params.incident_type_id

      // Wrap in incident object with required notify_incident_channel
      return {
        incident,
        notify_incident_channel: params.notify_incident_channel,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const incident = data.incident || data

    return {
      success: true,
      output: {
        incident: {
          id: incident.id,
          name: incident.name,
          summary: incident.summary,
          description: incident.description,
          mode: incident.mode,
          call_url: incident.call_url,
          severity: incident.severity
            ? {
                id: incident.severity.id,
                name: incident.severity.name,
                rank: incident.severity.rank,
              }
            : undefined,
          status: incident.incident_status
            ? {
                id: incident.incident_status.id,
                name: incident.incident_status.name,
                category: incident.incident_status.category,
              }
            : undefined,
          incident_type: incident.incident_type
            ? {
                id: incident.incident_type.id,
                name: incident.incident_type.name,
              }
            : undefined,
          created_at: incident.created_at,
          updated_at: incident.updated_at,
          incident_url: incident.incident_url,
          slack_channel_id: incident.slack_channel_id,
          slack_channel_name: incident.slack_channel_name,
          visibility: incident.visibility,
        },
      },
    }
  },

  outputs: {
    incident: {
      type: 'object',
      description: 'The updated incident object',
      properties: {
        id: { type: 'string', description: 'Incident ID' },
        name: { type: 'string', description: 'Incident name' },
        summary: { type: 'string', description: 'Brief summary of the incident' },
        description: { type: 'string', description: 'Detailed description of the incident' },
        mode: { type: 'string', description: 'Incident mode (e.g., standard, retrospective)' },
        call_url: { type: 'string', description: 'URL for the incident call/bridge' },
        severity: {
          type: 'object',
          description: 'Severity of the incident',
          properties: {
            id: { type: 'string', description: 'Severity ID' },
            name: { type: 'string', description: 'Severity name' },
            rank: { type: 'number', description: 'Severity rank' },
          },
        },
        status: {
          type: 'object',
          description: 'Current status of the incident',
          properties: {
            id: { type: 'string', description: 'Status ID' },
            name: { type: 'string', description: 'Status name' },
            category: { type: 'string', description: 'Status category' },
          },
        },
        incident_type: {
          type: 'object',
          description: 'Type of the incident',
          properties: {
            id: { type: 'string', description: 'Type ID' },
            name: { type: 'string', description: 'Type name' },
          },
        },
        created_at: { type: 'string', description: 'Creation timestamp' },
        updated_at: { type: 'string', description: 'Last update timestamp' },
        incident_url: { type: 'string', description: 'URL to the incident' },
        slack_channel_id: { type: 'string', description: 'Associated Slack channel ID' },
        slack_channel_name: { type: 'string', description: 'Associated Slack channel name' },
        visibility: { type: 'string', description: 'Incident visibility' },
      },
    },
  },
}
