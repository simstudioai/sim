import type {
  PagerDutyGetIncidentParams,
  PagerDutyGetIncidentResponse,
} from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const getIncidentTool: ToolConfig<PagerDutyGetIncidentParams, PagerDutyGetIncidentResponse> =
  {
    id: 'pagerduty_get_incident',
    name: 'PagerDuty Get Incident',
    description: 'Get a single incident from PagerDuty by ID.',
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
        description: 'ID of the incident to fetch',
      },
    },

    request: {
      url: (params) =>
        `https://api.pagerduty.com/incidents/${params.incidentId.trim()}?include[]=services`,
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
          updatedAt: inc.updated_at ?? null,
          resolvedAt: inc.resolved_at ?? null,
          serviceName: inc.service?.summary ?? null,
          serviceId: inc.service?.id ?? null,
          assigneeName: inc.assignments?.[0]?.assignee?.summary ?? null,
          assigneeId: inc.assignments?.[0]?.assignee?.id ?? null,
          escalationPolicyName: inc.escalation_policy?.summary ?? null,
          escalationPolicyId: inc.escalation_policy?.id ?? null,
          incidentKey: inc.incident_key ?? null,
          htmlUrl: inc.html_url ?? null,
        },
      }
    },

    outputs: {
      id: { type: 'string', description: 'Incident ID' },
      incidentNumber: { type: 'number', description: 'Incident number' },
      title: { type: 'string', description: 'Incident title' },
      status: { type: 'string', description: 'Incident status' },
      urgency: { type: 'string', description: 'Incident urgency' },
      createdAt: { type: 'string', description: 'Creation timestamp' },
      updatedAt: { type: 'string', description: 'Last updated timestamp', optional: true },
      resolvedAt: { type: 'string', description: 'Resolution timestamp', optional: true },
      serviceName: { type: 'string', description: 'Service name', optional: true },
      serviceId: { type: 'string', description: 'Service ID', optional: true },
      assigneeName: { type: 'string', description: 'Assignee name', optional: true },
      assigneeId: { type: 'string', description: 'Assignee ID', optional: true },
      escalationPolicyName: {
        type: 'string',
        description: 'Escalation policy name',
        optional: true,
      },
      escalationPolicyId: { type: 'string', description: 'Escalation policy ID', optional: true },
      incidentKey: { type: 'string', description: 'De-duplication key', optional: true },
      htmlUrl: { type: 'string', description: 'PagerDuty web URL' },
    },
  }
