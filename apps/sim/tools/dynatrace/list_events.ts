import {
  eventProperties,
  nextPageKeyOutput,
  pageSizeOutput,
  totalCountOutput,
  warningsOutput,
} from '@/tools/dynatrace/outputs'
import type {
  DynatraceListEventsParams,
  DynatraceListEventsResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapEvent,
  mapWarnings,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const listEventsTool: ToolConfig<DynatraceListEventsParams, DynatraceListEventsResponse> = {
  id: 'dynatrace_list_events',
  name: 'Dynatrace List Events',
  description:
    'List events — deployments, availability changes, alerts, custom annotations — in a Dynatrace environment.',
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
      description: 'Dynatrace access token (dt0c01...) with the events.read scope',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start of the timeframe as UTC milliseconds, ISO 8601, or a relative expression such as now-1d. Defaults to now-2h',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the timeframe in the same formats as From. Defaults to now',
    },
    eventSelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Event selector, e.g. eventType("CUSTOM_DEPLOYMENT"),status("OPEN"),correlationId("build-42")',
    },
    entitySelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Entity selector scoping the result, e.g. type("SERVICE"),tag("env:prod")',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Events per page (max 1000, default 100)',
    },
    nextPageKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for the next page. All other filters are ignored when it is set',
    },
  },

  request: {
    url: (params) =>
      params.nextPageKey
        ? buildDynatraceUrl(params.environmentUrl, '/events', {
            nextPageKey: params.nextPageKey,
          })
        : buildDynatraceUrl(params.environmentUrl, '/events', {
            from: params.from,
            to: params.to,
            eventSelector: params.eventSelector,
            entitySelector: params.entitySelector,
            pageSize: params.pageSize,
          }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const events = Array.isArray(data.events) ? (data.events as Array<Record<string, unknown>>) : []

    return {
      success: true,
      output: {
        events: events.map(mapEvent),
        totalCount: (data.totalCount as number) ?? null,
        pageSize: (data.pageSize as number) ?? null,
        nextPageKey: (data.nextPageKey as string) ?? null,
        warnings: mapWarnings(data.warnings),
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'Matching events',
      items: { type: 'object', properties: eventProperties },
    },
    totalCount: totalCountOutput,
    pageSize: pageSizeOutput,
    nextPageKey: nextPageKeyOutput,
    warnings: warningsOutput,
  },
}
