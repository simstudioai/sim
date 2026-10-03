import type {
  IncidentioAlertEventsCreateParams,
  IncidentioAlertEventsCreateResponse,
} from '@/tools/incidentio/types'
import { parseIncidentioJsonParam } from '@/tools/incidentio/utils'
import type { ToolConfig } from '@/tools/types'

export const alertEventsCreateTool: ToolConfig<
  IncidentioAlertEventsCreateParams,
  IncidentioAlertEventsCreateResponse
> = {
  id: 'incidentio_alert_events_create',
  name: 'Create Alert Event',
  description:
    'Fire an alert into incident.io through an HTTP alert source. Send the same deduplication key with status "resolved" to close the alert you opened.',
  version: '1.0.0',

  params: {
    alert_source_config_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the HTTP alert source config to fire into (e.g., "01GW2G3V0S59R238FAHPDS1R66")',
    },
    alert_source_token: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'The token generated when configuring the HTTP alert source. This is not the incident.io API key.',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the alert (e.g., "Payments service error rate above 5%")',
    },
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current status of the alert: "firing" or "resolved"',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Detail to add below the title. Supports Markdown.',
    },
    deduplication_key: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Key that uniquely identifies this alert. Reuse it to update or resolve the same alert instead of creating a new one.',
    },
    source_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Link back to the alert in the upstream system',
    },
    metadata: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Additional metadata as a JSON object, parsed according to the alert source config (e.g., {"service": "payments"})',
    },
  },

  request: {
    url: (params) =>
      `https://api.incident.io/v2/alert_events/http/${encodeURIComponent(
        params.alert_source_config_id.trim()
      )}`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.alert_source_token}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        title: params.title,
        status: params.status,
      }

      if (params.description) body.description = params.description
      if (params.deduplication_key) body.deduplication_key = params.deduplication_key
      if (params.source_url) body.source_url = params.source_url
      if (params.metadata) {
        body.metadata = parseIncidentioJsonParam(params.metadata, 'metadata', undefined)
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        deduplication_key: data.deduplication_key,
        message: data.message,
        status: data.status,
      },
    }
  },

  outputs: {
    deduplication_key: {
      type: 'string',
      description: 'The deduplication key the event was processed with',
    },
    message: {
      type: 'string',
      description: 'Human readable message giving detail about the event',
    },
    status: {
      type: 'string',
      description: 'Status of the event',
    },
  },
}
