import type {
  DynatraceSearchLogsParams,
  DynatraceSearchLogsResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapLogRecord,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const searchLogsTool: ToolConfig<DynatraceSearchLogsParams, DynatraceSearchLogsResponse> = {
  id: 'dynatrace_search_logs',
  name: 'Dynatrace Search Logs',
  description:
    'Search log records in Dynatrace by query and timeframe, for troubleshooting and incident analysis.',
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
      description:
        'Dynatrace access token (dt0c01...) with the logs.read scope, or storage:logs:read and storage:buckets:read on Grail',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Log search query, e.g. status="ERROR" AND dt.entity.host="HOST-06F288EE2A930951"',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start of the timeframe as UTC milliseconds, ISO 8601, or a relative expression such as now-1h. Defaults to now-2w',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the timeframe in the same formats as From. Defaults to now',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by field with a + or - prefix, e.g. -timestamp for newest first',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of log records to return (max 1000, default 1000)',
    },
    nextSliceKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for the next slice. All other filters are ignored when it is set',
    },
  },

  request: {
    url: (params) =>
      params.nextSliceKey
        ? buildDynatraceUrl(params.environmentUrl, '/logs/search', {
            nextSliceKey: params.nextSliceKey,
          })
        : buildDynatraceUrl(params.environmentUrl, '/logs/search', {
            query: params.query,
            from: params.from,
            to: params.to,
            sort: params.sort,
            limit: params.limit,
          }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const results = Array.isArray(data.results)
      ? (data.results as Array<Record<string, unknown>>)
      : []

    return {
      success: true,
      output: {
        results: results.map(mapLogRecord),
        sliceSize: (data.sliceSize as number) ?? null,
        nextSliceKey: (data.nextSliceKey as string) ?? null,
        warnings: (data.warnings as string) ?? null,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Matching log records',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'number', description: 'Log timestamp in UTC milliseconds' },
          status: {
            type: 'string',
            description: 'Log level: ERROR, WARN, INFO, NONE, or NOT_APPLICABLE',
          },
          content: { type: 'string', description: 'Log message content' },
          eventType: { type: 'string', description: 'Event type of the record', nullable: true },
          additionalColumns: {
            type: 'json',
            description: 'Additional log attributes keyed by column name',
          },
        },
      },
    },
    sliceSize: {
      type: 'number',
      description: 'Number of records in this slice',
      nullable: true,
    },
    nextSliceKey: {
      type: 'string',
      description: 'Cursor for the next slice. Null when the result is complete',
      nullable: true,
    },
    warnings: {
      type: 'string',
      description: 'Warning raised while searching',
      nullable: true,
    },
  },
}
