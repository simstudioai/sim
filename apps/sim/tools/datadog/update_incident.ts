import type { UpdateIncidentParams, UpdateIncidentResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
  parseJsonParam,
  splitCommaList,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const updateIncidentTool: ToolConfig<UpdateIncidentParams, UpdateIncidentResponse> = {
  id: 'datadog_update_incident',
  name: 'Datadog Update Incident',
  description:
    'Partially update an existing incident. Requires the Incident Management `incident_write` permission; the Incidents API is in public beta.',
  version: '1.0.0',

  params: {
    incidentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the incident to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New title for the incident',
    },
    severity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Incident severity: UNKNOWN, SEV-0, SEV-1, SEV-2, SEV-3, SEV-4, or SEV-5',
    },
    customerImpacted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the incident caused customer impact',
    },
    customerImpactScope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Summary of the customer impact',
    },
    customerImpactStart: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO-8601 timestamp when customers began being impacted',
    },
    customerImpactEnd: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO-8601 timestamp when customers were no longer impacted',
    },
    detected: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO-8601 timestamp when the incident was detected',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of user-defined incident fields to update, e.g. {"state": {"type": "dropdown", "value": "resolved"}}',
    },
    notificationHandles: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated handles to notify about the update',
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
    url: (params) =>
      datadogApiUrl(params.site, `/api/v2/incidents/${datadogPathSegment(params.incidentId)}`),
    method: 'PATCH',
    headers: datadogHeaders,
    body: (params) => {
      const fields =
        parseJsonParam<Record<string, unknown>>(params.fields, 'fields parameter') ?? {}
      if (params.severity) {
        fields.severity = { type: 'dropdown', value: params.severity }
      }

      /**
       * Only non-empty values are sent. An empty string is how an untouched input
       * arrives, and Datadog would take it literally — blanking the stored title or
       * rejecting the request as an invalid `date-time`.
       */
      const attributes: Record<string, unknown> = {}
      if (params.title) attributes.title = params.title
      if (params.customerImpacted !== undefined)
        attributes.customer_impacted = params.customerImpacted
      if (params.customerImpactScope) attributes.customer_impact_scope = params.customerImpactScope
      if (params.customerImpactStart) attributes.customer_impact_start = params.customerImpactStart
      if (params.customerImpactEnd) attributes.customer_impact_end = params.customerImpactEnd
      if (params.detected) attributes.detected = params.detected
      if (Object.keys(fields).length > 0) attributes.fields = fields

      const handles = splitCommaList(params.notificationHandles)
      if (handles) {
        attributes.notification_handles = handles.map((handle) => ({ handle }))
      }

      return { data: { type: 'incidents', id: params.incidentId, attributes } }
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
      description: 'The updated incident',
      properties: {
        id: { type: 'string', description: 'Incident UUID' },
        type: { type: 'string', description: 'Resource type (incidents)' },
        attributes: {
          type: 'object',
          description: 'Incident attributes',
          properties: {
            title: { type: 'string', description: 'Incident title' },
            state: { type: 'string', description: 'Incident state' },
            severity: { type: 'string', description: 'Incident severity' },
            modified: { type: 'string', description: 'Last modification timestamp' },
            resolved: { type: 'string', description: 'Resolution timestamp' },
          },
        },
      },
    },
  },
}
