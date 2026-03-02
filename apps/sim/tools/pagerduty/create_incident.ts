import type {
  PagerDutyCreateIncidentParams,
  PagerDutyCreateIncidentResponse,
} from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const createIncidentTool: ToolConfig<
  PagerDutyCreateIncidentParams,
  PagerDutyCreateIncidentResponse
> = {
  id: 'pagerduty_create_incident',
  name: 'PagerDuty Create Incident',
  description: 'Create a new incident in PagerDuty.',
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Incident title/summary',
    },
    serviceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the PagerDuty service',
    },
    urgency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Urgency level (high or low)',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Detailed description of the incident',
    },
    escalationPolicyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Escalation policy ID to assign',
    },
    assigneeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID to assign the incident to',
    },
  },

  request: {
    url: 'https://api.pagerduty.com/incidents',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Token token=${params.apiKey}`,
      Accept: 'application/vnd.pagerduty+json;version=2',
      'Content-Type': 'application/json',
      From: params.fromEmail,
    }),
    body: (params) => {
      const incident: Record<string, unknown> = {
        type: 'incident',
        title: params.title,
        service: {
          id: params.serviceId,
          type: 'service_reference',
        },
      }

      if (params.urgency) incident.urgency = params.urgency
      if (params.body) {
        incident.body = {
          type: 'incident_body',
          details: params.body,
        }
      }
      if (params.escalationPolicyId) {
        incident.escalation_policy = {
          id: params.escalationPolicyId,
          type: 'escalation_policy_reference',
        }
      }
      if (params.assigneeId) {
        incident.assignments = [
          {
            assignee: {
              id: params.assigneeId,
              type: 'user_reference',
            },
          },
        ]
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
        createdAt: inc.created_at ?? null,
        serviceName: inc.service?.summary ?? null,
        serviceId: inc.service?.id ?? null,
        htmlUrl: inc.html_url ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Created incident ID' },
    incidentNumber: { type: 'number', description: 'Incident number' },
    title: { type: 'string', description: 'Incident title' },
    status: { type: 'string', description: 'Incident status' },
    urgency: { type: 'string', description: 'Incident urgency' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    serviceName: { type: 'string', description: 'Service name' },
    serviceId: { type: 'string', description: 'Service ID' },
    htmlUrl: { type: 'string', description: 'PagerDuty web URL' },
  },
}
