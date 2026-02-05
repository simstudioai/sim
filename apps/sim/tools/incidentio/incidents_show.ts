import type {
  IncidentioIncidentsShowParams,
  IncidentioIncidentsShowResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const incidentsShowTool: ToolConfig<
  IncidentioIncidentsShowParams,
  IncidentioIncidentsShowResponse
> = {
  id: 'incidentio_incidents_show',
  name: 'incident.io Incidents Show',
  description:
    'Retrieve detailed information about a specific incident from incident.io by its ID. Returns full incident details including custom fields and role assignments.',
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
      description: 'ID of the incident to retrieve (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/incidents/${params.id}`,
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
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
          permalink: incident.permalink,
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
          custom_field_entries: incident.custom_field_entries?.map((entry: any) => ({
            custom_field: {
              id: entry.custom_field.id,
              name: entry.custom_field.name,
              field_type: entry.custom_field.field_type,
            },
            values: entry.values?.map((value: any) => ({
              value_text: value.value_text,
              value_link: value.value_link,
              value_numeric: value.value_numeric,
            })),
          })),
          incident_role_assignments: incident.incident_role_assignments?.map((assignment: any) => ({
            role: {
              id: assignment.role.id,
              name: assignment.role.name,
              role_type: assignment.role.role_type,
            },
            assignee: assignment.assignee
              ? {
                  id: assignment.assignee.id,
                  name: assignment.assignee.name,
                  email: assignment.assignee.email,
                }
              : undefined,
          })),
        },
      },
    }
  },

  outputs: {
    incident: {
      type: 'object',
      description: 'Detailed incident information',
      properties: {
        id: { type: 'string', description: 'Incident ID' },
        name: { type: 'string', description: 'Incident name' },
        summary: { type: 'string', description: 'Brief summary of the incident' },
        description: { type: 'string', description: 'Detailed description of the incident' },
        mode: { type: 'string', description: 'Incident mode (e.g., standard, retrospective)' },
        call_url: { type: 'string', description: 'URL for the incident call/bridge' },
        permalink: { type: 'string', description: 'Permanent link to the incident' },
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
        custom_field_entries: {
          type: 'array',
          description: 'Custom field values for the incident',
        },
        incident_role_assignments: {
          type: 'array',
          description: 'Role assignments for the incident',
        },
      },
    },
  },
}
