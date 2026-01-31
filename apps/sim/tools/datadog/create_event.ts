import type { CreateEventParams, CreateEventResponse } from '@/tools/datadog/types'
import type { ToolConfig } from '@/tools/types'

export const createEventTool: ToolConfig<CreateEventParams, CreateEventResponse> = {
  id: 'datadog_create_event',
  name: 'Datadog Create Event',
  description:
    'Post an event to the Datadog event stream. Use for deployment notifications, alerts, or any significant occurrences.',
  version: '1.0.0',

  params: {
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event title',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event body/description. Supports markdown.',
    },
    alertType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Alert type: error, warning, info, success, user_update, recommendation, or snapshot',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event priority: normal or low',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Host name to associate with this event (e.g., "web-server-01", "prod-api-1")',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of tags (e.g., "env:production,service:api", "team:backend,priority:high")',
    },
    aggregationKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Key to aggregate events together',
    },
    sourceTypeName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Source type name for the event',
    },
    dateHappened: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unix timestamp in seconds when the event occurred (e.g., 1705320000, defaults to now)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
    },
    site: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Datadog site/region (default: datadoghq.com)',
    },
  },

  request: {
    url: (params) => {
      const site = params.site || 'datadoghq.com'
      return `https://api.${site}/api/v1/events`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'DD-API-KEY': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        title: params.title,
        text: params.text,
      }

      if (params.alertType) body.alert_type = params.alertType
      if (params.priority) body.priority = params.priority
      if (params.host) body.host = params.host
      if (params.aggregationKey) body.aggregation_key = params.aggregationKey
      if (params.sourceTypeName) body.source_type_name = params.sourceTypeName
      if (params.dateHappened) body.date_happened = params.dateHappened

      if (params.tags) {
        body.tags = params.tags
          .split(',')
          .map((t: string) => t.trim())
          .filter((t: string) => t.length > 0)
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: {
          event: {} as any,
        },
        error: errorData.errors?.[0] || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        event: {
          id: data.event?.id,
          title: data.event?.title,
          text: data.event?.text,
          date_happened: data.event?.date_happened,
          priority: data.event?.priority,
          alert_type: data.event?.alert_type,
          host: data.event?.host,
          tags: data.event?.tags,
          url: data.event?.url,
        },
      },
    }
  },

  outputs: {
    event: {
      type: 'object',
      description: 'The created event details',
      properties: {
        id: { type: 'number', description: 'Event ID' },
        title: { type: 'string', description: 'Event title' },
        text: { type: 'string', description: 'Event text' },
        date_happened: { type: 'number', description: 'Unix timestamp when event occurred' },
        priority: { type: 'string', description: 'Event priority' },
        alert_type: { type: 'string', description: 'Alert type' },
        host: { type: 'string', description: 'Associated host' },
        tags: { type: 'array', description: 'Event tags' },
        url: { type: 'string', description: 'URL to view the event in Datadog' },
      },
    },
  },
}
