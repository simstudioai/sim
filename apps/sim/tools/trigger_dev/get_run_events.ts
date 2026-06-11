import type { TriggerDevRunEventsResponse, TriggerDevRunIdParams } from '@/tools/trigger_dev/types'
import { buildTriggerDevHeaders, TRIGGER_DEV_API_BASE } from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevGetRunEventsTool: ToolConfig<
  TriggerDevRunIdParams,
  TriggerDevRunEventsResponse
> = {
  id: 'trigger_dev_get_run_events',
  name: 'Trigger.dev Get Run Events',
  description:
    'Retrieve the log and span events of a Trigger.dev run, including messages, levels, durations, and error events.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the run to retrieve events for (starts with run_)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/runs/${encodeURIComponent(params.runId.trim())}/events`,
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        events: (data.events ?? []).map(
          (event: {
            spanId?: string
            parentId?: string | null
            runId?: string | null
            message?: string
            startTime?: string
            duration?: number
            isError?: boolean
            isPartial?: boolean
            isCancelled?: boolean
            level?: string
            kind?: string
            attemptNumber?: number | null
            taskSlug?: string
            events?: { name?: string; time?: string; properties?: Record<string, unknown> }[]
          }) => ({
            spanId: event.spanId ?? null,
            parentId: event.parentId ?? null,
            runId: event.runId ?? null,
            message: event.message ?? null,
            startTime: event.startTime ?? null,
            duration: event.duration ?? null,
            isError: event.isError ?? false,
            isPartial: event.isPartial ?? false,
            isCancelled: event.isCancelled ?? false,
            level: event.level ?? null,
            kind: event.kind ?? null,
            attemptNumber: event.attemptNumber ?? null,
            taskSlug: event.taskSlug ?? null,
            events: (event.events ?? []).map((spanEvent) => ({
              name: spanEvent.name ?? null,
              time: spanEvent.time ?? null,
              properties: spanEvent.properties ?? null,
            })),
          })
        ),
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'Log and span events recorded during the run',
      items: {
        type: 'object',
        description: 'Run event',
        properties: {
          spanId: { type: 'string', description: 'Span ID of the event', nullable: true },
          parentId: { type: 'string', description: 'Parent span ID', nullable: true },
          runId: {
            type: 'string',
            description: 'Run ID associated with the event',
            nullable: true,
          },
          message: { type: 'string', description: 'Event message', nullable: true },
          startTime: {
            type: 'string',
            description: 'Start time as a bigint string (nanoseconds since epoch)',
            nullable: true,
          },
          duration: {
            type: 'number',
            description: 'Duration of the event in nanoseconds',
            nullable: true,
          },
          isError: { type: 'boolean', description: 'Whether the event represents an error' },
          isPartial: { type: 'boolean', description: 'Whether the event is still in progress' },
          isCancelled: { type: 'boolean', description: 'Whether the event was cancelled' },
          level: {
            type: 'string',
            description: 'Log level (TRACE, DEBUG, LOG, INFO, WARN, or ERROR)',
            nullable: true,
          },
          kind: { type: 'string', description: 'Kind of span event', nullable: true },
          attemptNumber: {
            type: 'number',
            description: 'Attempt number the event belongs to',
            nullable: true,
          },
          taskSlug: { type: 'string', description: 'Task identifier', nullable: true },
          events: {
            type: 'array',
            description: 'Span events (e.g., exceptions) that occurred during this event',
            items: {
              type: 'object',
              description: 'Span event',
              properties: {
                name: { type: 'string', description: 'Event name', nullable: true },
                time: { type: 'string', description: 'When the event occurred', nullable: true },
                properties: {
                  type: 'json',
                  description: 'Event-specific properties',
                  nullable: true,
                },
              },
            },
          },
        },
      },
    },
  },
}
