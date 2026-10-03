import type { CreateIncidentParams, CreateIncidentResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  parseJsonParam,
  splitCommaList,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const createIncidentTool: ToolConfig<CreateIncidentParams, CreateIncidentResponse> = {
  id: 'datadog_create_incident',
  name: 'Datadog Create Incident',
  description:
    'Declare a new incident. Requires the Incident Management `incident_write` permission; the Incidents API is in public beta.',
  version: '1.0.0',

  params: {
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the incident summarizing what happened',
    },
    customerImpacted: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether the incident caused customer impact',
    },
    severity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Incident severity: UNKNOWN, SEV-0, SEV-1, SEV-2, SEV-3, SEV-4, or SEV-5',
    },
    customerImpactScope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Summary of the customer impact. Required when customerImpacted is true',
    },
    incidentTypeUuid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of the incident type. The default incident type is used when omitted',
    },
    isTest: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether this is a test incident',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of user-defined incident fields, e.g. {"severity": {"type": "dropdown", "value": "SEV-2"}}',
    },
    notificationHandles: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated handles to notify on creation (e.g., "@slack-incidents,@user@example.com")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
    },
    applicationKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog Application key',
    },
    site: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Datadog site/region (default: datadoghq.com)',
    },
  },

  request: {
    url: (params) => datadogApiUrl(params.site, '/api/v2/incidents'),
    method: 'POST',
    headers: datadogHeaders,
    body: (params) => {
      const fields =
        parseJsonParam<Record<string, unknown>>(params.fields, 'fields parameter') ?? {}
      if (params.severity) {
        fields.severity = { type: 'dropdown', value: params.severity }
      }

      const attributes: Record<string, unknown> = {
        title: params.title,
        customer_impacted: params.customerImpacted,
      }
      if (params.customerImpactScope) attributes.customer_impact_scope = params.customerImpactScope
      if (params.incidentTypeUuid) attributes.incident_type_uuid = params.incidentTypeUuid
      if (params.isTest !== undefined) attributes.is_test = params.isTest
      if (Object.keys(fields).length > 0) attributes.fields = fields

      const handles = splitCommaList(params.notificationHandles)
      if (handles) {
        attributes.notification_handles = handles.map((handle) => ({ handle }))
      }

      return { data: { type: 'incidents', attributes } }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { incident: { id: '', attributes: {} } },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        incident: {
          id: data.data?.id,
          type: data.data?.type,
          attributes: data.data?.attributes ?? {},
        },
      },
    }
  },

  outputs: {
    incident: {
      type: 'object',
      description: 'The created incident',
      properties: {
        id: { type: 'string', description: 'Incident UUID' },
        type: { type: 'string', description: 'Resource type (incidents)' },
        attributes: {
          type: 'object',
          description: 'Incident attributes',
          properties: {
            title: { type: 'string', description: 'Incident title' },
            public_id: { type: 'number', description: 'Incremental public incident ID' },
            customer_impacted: { type: 'boolean', description: 'Whether customers were impacted' },
            created: { type: 'string', description: 'Creation timestamp' },
            modified: { type: 'string', description: 'Last modification timestamp' },
          },
        },
      },
    },
  },
}
