import type { PagerDutySendEventParams, PagerDutySendEventResponse } from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const sendEventTool: ToolConfig<PagerDutySendEventParams, PagerDutySendEventResponse> = {
  id: 'pagerduty_send_event',
  name: 'PagerDuty Send Event',
  description:
    'Send a trigger, acknowledge, or resolve event to PagerDuty Events API v2 using a service integration key. Used to page from monitoring/alerting sources without a PagerDuty user account.',
  version: '1.0.0',

  params: {
    routingKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Events API v2 integration key (routing key) for the target service',
    },
    eventAction: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event action: trigger, acknowledge, or resolve',
    },
    summary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Brief summary of the event. Required when eventAction is trigger',
    },
    source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unique location of the affected system (e.g. hostname). Required when eventAction is trigger',
    },
    severity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Perceived severity: critical, warning, error, or info. Required when eventAction is trigger',
    },
    dedupKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'De-duplication key identifying the alert. Required when eventAction is acknowledge or resolve; optional on trigger',
    },
    component: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Component of the source machine responsible for the event',
    },
    group: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Logical grouping of components of a service',
    },
    class: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The class/type of the event',
    },
  },

  request: {
    url: 'https://events.pagerduty.com/v2/enqueue',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        routing_key: params.routingKey,
        event_action: params.eventAction,
      }

      if (params.dedupKey) body.dedup_key = params.dedupKey

      if (params.eventAction === 'trigger') {
        body.payload = {
          summary: params.summary,
          source: params.source,
          severity: params.severity,
          ...(params.component && { component: params.component }),
          ...(params.group && { group: params.group }),
          ...(params.class && { class: params.class }),
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || `PagerDuty Events API error: ${response.status}`)
    }

    return {
      success: true,
      output: {
        status: data.status ?? null,
        message: data.message ?? null,
        dedupKey: data.dedup_key ?? null,
      },
    }
  },

  outputs: {
    status: { type: 'string', description: 'Result status ("success" if accepted)' },
    message: { type: 'string', description: 'Description of the result', optional: true },
    dedupKey: { type: 'string', description: 'De-duplication key for the alert', optional: true },
  },
}
