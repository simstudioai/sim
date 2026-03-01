import type {
  PagerDutyUpdateIncidentParams,
  PagerDutyUpdateIncidentResponse,
} from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const updateIncidentTool: ToolConfig<
  PagerDutyUpdateIncidentParams,
  PagerDutyUpdateIncidentResponse
> = {
  id: 'pagerduty_update_incident',
  name: 'PagerDuty Update Incident',
  description: 'Update an incident in PagerDuty (acknowledge, resolve, change urgency, etc.).',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PagerDuty REST API Key',
    },
    fromEmail: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of a valid PagerDuty user',
    },
    incidentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the incident to update',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New status (acknowledged or resolved)',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New incident title',
    },
    urgency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New urgency (high or low)',
    },
    escalationLevel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Escalation level to escalate to',
    },
  },

  request: {
    url: (params) => `https://api.pagerduty.com/incidents/${params.incidentId.trim()}`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Token token=${params.apiKey}`,
      Accept: 'application/vnd.pagerduty+json;version=2',
      'Content-Type': 'application/json',
      From: params.fromEmail,
    }),
    body: (params) => {
      const incident: Record<string, unknown> = {
        id: params.incidentId,
        type: 'incident',
      }

      if (params.status) incident.status = params.status
      if (params.title) incident.title = params.title
      if (params.urgency) incident.urgency = params.urgency
      if (params.escalationLevel) {
        incident.escalation_level = Number(params.escalationLevel)
      }
      return { incident }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || `PagerDuty API error: ${response.status}`)
    }

    const inc = data.incident ?? {}
    return {
      success: true,
      output: {
        id: inc.id ?? null,
        incidentNumber: inc.incident_number ?? null,
        title: inc.title ?? null,
        status: inc.status ?? null,
        urgency: inc.urgency ?? null,
        updatedAt: inc.updated_at ?? null,
        htmlUrl: inc.html_url ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Incident ID' },
    incidentNumber: { type: 'number', description: 'Incident number' },
    title: { type: 'string', description: 'Incident title' },
    status: { type: 'string', description: 'Updated status' },
    urgency: { type: 'string', description: 'Updated urgency' },
    updatedAt: { type: 'string', description: 'Last updated timestamp' },
    htmlUrl: { type: 'string', description: 'PagerDuty web URL' },
  },
}
