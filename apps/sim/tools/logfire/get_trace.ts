import type {
  LogfireGetTraceParams,
  LogfireQueryApiResponse,
  LogfireRecordsResponse,
} from '@/tools/logfire/types'
import { LOGFIRE_RECORD_OUTPUT_ITEM } from '@/tools/logfire/types'
import {
  buildLogfireQueryBody,
  extractLogfireRows,
  LOGFIRE_QUERY_PATH,
  LOGFIRE_RECORD_PROJECTION,
  logfireHeaders,
  logfireUrl,
  normalizeLogfireRecord,
  parseLogfireResponse,
  sqlLiteral,
} from '@/tools/logfire/utils'
import type { ToolConfig } from '@/tools/types'

const buildTraceSql = (traceId: string): string =>
  `SELECT ${LOGFIRE_RECORD_PROJECTION} FROM records WHERE trace_id = ${sqlLiteral(traceId.trim())} ORDER BY start_timestamp ASC`

export const logfireGetTraceTool: ToolConfig<LogfireGetTraceParams, LogfireRecordsResponse> = {
  id: 'logfire_get_trace',
  name: 'Logfire Get Trace',
  description:
    'Fetch every span and log belonging to a Logfire trace, ordered from earliest to latest, so a single request can be reconstructed end to end.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Logfire read token',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Logfire data region: auto, us, or eu. Auto reads the region from the token.',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Base URL of a self-hosted Logfire instance, e.g. https://logfire.example.com. Overrides region. Leave blank for Logfire Cloud.',
    },
    traceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: '32-character hexadecimal trace identifier',
    },
    minTimestamp: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO 8601 lower bound on start_timestamp. Defaults to 2020-01-01T00:00:00Z when omitted.',
    },
    maxTimestamp: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 upper bound on start_timestamp',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum spans to return. Logfire defaults to 100 and caps at 10000.',
    },
  },

  request: {
    url: (params) => logfireUrl(params, LOGFIRE_QUERY_PATH),
    method: 'POST',
    headers: (params) => logfireHeaders(params.apiKey),
    body: (params) =>
      buildLogfireQueryBody({
        sql: buildTraceSql(params.traceId),
        minTimestamp: params.minTimestamp,
        maxTimestamp: params.maxTimestamp,
        limit: params.limit,
      }),
  },

  transformResponse: async (response, params) => {
    const results = await parseLogfireResponse<LogfireQueryApiResponse>(response)
    const rows = extractLogfireRows(results).map(normalizeLogfireRecord)

    return {
      success: true,
      output: {
        rows,
        rowCount: rows.length,
        sql: params ? buildTraceSql(params.traceId) : '',
      },
    }
  },

  outputs: {
    rows: {
      type: 'array',
      description: 'Spans and logs in the trace, earliest first',
      items: LOGFIRE_RECORD_OUTPUT_ITEM,
    },
    rowCount: { type: 'number', description: 'Number of rows returned' },
    sql: { type: 'string', description: 'SQL query that was executed against Logfire' },
  },
}
