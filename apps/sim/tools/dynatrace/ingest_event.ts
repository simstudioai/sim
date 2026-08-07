import type {
  DynatraceIngestEventParams,
  DynatraceIngestEventResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  parseJsonParam,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const ingestEventTool: ToolConfig<DynatraceIngestEventParams, DynatraceIngestEventResponse> =
  {
    id: 'dynatrace_ingest_event',
    name: 'Dynatrace Ingest Event',
    description:
      'Push an event into Dynatrace — a deployment marker, custom annotation, or custom alert — attached to the entities matched by an entity selector.',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.DYNATRACE_ERRORS,

    params: {
      environmentUrl: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description:
          'Dynatrace environment URL (e.g., https://abc12345.live.dynatrace.com, or https://your-activegate:9999/e/abc12345 for Managed)',
      },
      apiToken: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Dynatrace access token (dt0c01...) with the events.ingest scope',
      },
      eventType: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'One of AVAILABILITY_EVENT, CUSTOM_ALERT, CUSTOM_ANNOTATION, CUSTOM_CONFIGURATION, CUSTOM_DEPLOYMENT, CUSTOM_INFO, ERROR_EVENT, MARKED_FOR_TERMINATION, PERFORMANCE_EVENT, RESOURCE_CONTENTION_EVENT, WARNING',
      },
      title: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Title of the event',
      },
      entitySelector: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Entity selector for the entities to attach the event to. Defaults to the environment entity',
      },
      startTime: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Event start in UTC milliseconds. Defaults to now',
      },
      endTime: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Event end in UTC milliseconds. Defaults to the start time plus the timeout',
      },
      eventTimeout: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Minutes the event stays open when no end time is given. Defaults to 15, capped at 360',
      },
      properties: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Event properties as a key-value object. Max 100 entries, keys up to 100 and values up to 4096 characters',
      },
    },

    request: {
      url: (params) => buildDynatraceUrl(params.environmentUrl, '/events/ingest'),
      method: 'POST',
      headers: (params) => dynatraceHeaders(params.apiToken),
      body: (params) => {
        const body: Record<string, unknown> = {
          eventType: params.eventType,
          title: params.title,
        }
        if (params.entitySelector) body.entitySelector = params.entitySelector
        if (params.startTime !== undefined) body.startTime = params.startTime
        if (params.endTime !== undefined) body.endTime = params.endTime
        if (params.eventTimeout !== undefined) body.timeout = params.eventTimeout
        const properties = parseJsonParam(params.properties)
        if (properties) body.properties = properties
        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await readJsonBody(response)
      const results = Array.isArray(data.eventIngestResults)
        ? (data.eventIngestResults as Array<Record<string, unknown>>)
        : []

      return {
        success: true,
        output: {
          reportCount: (data.reportCount as number) ?? null,
          eventIngestResults: results.map((result) => ({
            correlationId: (result.correlationId as string) ?? null,
            status: (result.status as string) ?? null,
          })),
        },
      }
    },

    outputs: {
      reportCount: {
        type: 'number',
        description: 'Number of events Dynatrace reported',
        nullable: true,
      },
      eventIngestResults: {
        type: 'array',
        description: 'One result per ingested event',
        items: {
          type: 'object',
          properties: {
            correlationId: {
              type: 'string',
              description: 'Correlation ID of the ingested event',
              nullable: true,
            },
            status: {
              type: 'string',
              description: 'OK, INVALID_ENTITY_TYPE, INVALID_METADATA, or INVALID_TIMESTAMPS',
            },
          },
        },
      },
    },
  }
