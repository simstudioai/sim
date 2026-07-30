import type {
  PagerDutyGetServiceParams,
  PagerDutyGetServiceResponse,
} from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const getServiceTool: ToolConfig<PagerDutyGetServiceParams, PagerDutyGetServiceResponse> = {
  id: 'pagerduty_get_service',
  name: 'PagerDuty Get Service',
  description: 'Get a single service from PagerDuty by ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PagerDuty REST API Key',
    },
    serviceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the service to fetch',
    },
  },

  request: {
    url: (params) =>
      `https://api.pagerduty.com/services/${params.serviceId.trim()}?include[]=escalation_policies`,
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

    const svc = data.service ?? {}
    return {
      success: true,
      output: {
        id: svc.id ?? null,
        name: svc.name ?? null,
        description: svc.description ?? null,
        status: svc.status ?? null,
        autoResolveTimeout: svc.auto_resolve_timeout ?? null,
        acknowledgementTimeout: svc.acknowledgement_timeout ?? null,
        createdAt: svc.created_at ?? null,
        lastIncidentTimestamp: svc.last_incident_timestamp ?? null,
        escalationPolicyName: svc.escalation_policy?.summary ?? null,
        escalationPolicyId: svc.escalation_policy?.id ?? null,
        htmlUrl: svc.html_url ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Service ID' },
    name: { type: 'string', description: 'Service name' },
    description: { type: 'string', description: 'Service description', optional: true },
    status: { type: 'string', description: 'Service status' },
    autoResolveTimeout: {
      type: 'number',
      description: 'Seconds before an open incident auto-resolves',
      optional: true,
    },
    acknowledgementTimeout: {
      type: 'number',
      description: 'Seconds before an acknowledged incident reverts to triggered',
      optional: true,
    },
    createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
    lastIncidentTimestamp: {
      type: 'string',
      description: 'Timestamp of the most recent incident',
      optional: true,
    },
    escalationPolicyName: { type: 'string', description: 'Escalation policy name', optional: true },
    escalationPolicyId: { type: 'string', description: 'Escalation policy ID', optional: true },
    htmlUrl: { type: 'string', description: 'PagerDuty web URL' },
  },
}
