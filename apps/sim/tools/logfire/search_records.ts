import type {
  LogfireQueryApiResponse,
  LogfireRecordsResponse,
  LogfireSearchRecordsParams,
} from '@/tools/logfire/types'
import { LOGFIRE_RECORD_OUTPUT_ITEM } from '@/tools/logfire/types'
import {
  buildLogfireQueryBody,
  cleanOptionalString,
  extractLogfireRows,
  LOGFIRE_QUERY_PATH,
  LOGFIRE_RECORD_PROJECTION,
  logfireHeaders,
  logfireUrl,
  normalizeLogfireRecord,
  parseLogfireResponse,
  sqlContains,
  sqlLiteral,
} from '@/tools/logfire/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Build a `records` query from structured filters. Every user-supplied value is
 * emitted as an escaped SQL literal, never interpolated raw.
 */
function buildSearchSql(params: LogfireSearchRecordsParams): string {
  const conditions: string[] = []

  const query = cleanOptionalString(params.query)
  if (query) conditions.push(sqlContains('message', query))

  const service = cleanOptionalString(params.service)
  if (service) conditions.push(`service_name = ${sqlLiteral(service)}`)

  const spanName = cleanOptionalString(params.spanName)
  if (spanName) conditions.push(`span_name = ${sqlLiteral(spanName)}`)

  const minLevel = cleanOptionalString(params.minLevel)
  if (minLevel) conditions.push(`level >= ${sqlLiteral(minLevel)}`)

  if (params.exceptionsOnly) conditions.push('is_exception')

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''

  return `SELECT ${LOGFIRE_RECORD_PROJECTION} FROM records${where} ORDER BY start_timestamp DESC`
}

export const logfireSearchRecordsTool: ToolConfig<
  LogfireSearchRecordsParams,
  LogfireRecordsResponse
> = {
  id: 'logfire_search_records',
  name: 'Logfire Search Records',
  description:
    'Search Logfire spans and logs using structured filters for message text, service, span name, severity, environment, and exceptions. Returns the most recent matches first without writing SQL.',
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
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Case-insensitive text to match within the record message',
    },
    service: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact service name to filter on',
    },
    spanName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact span name to filter on',
    },
    minLevel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum severity to include: trace, debug, info, notice, warn, error, or fatal',
    },
    exceptionsOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return records that recorded an exception',
    },
    environment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict results to a single deployment environment',
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
      description: 'Maximum records to return. Logfire defaults to 100 and caps at 10000.',
    },
  },

  request: {
    url: (params) => logfireUrl(params, LOGFIRE_QUERY_PATH),
    method: 'POST',
    headers: (params) => logfireHeaders(params.apiKey),
    body: (params) =>
      buildLogfireQueryBody({
        sql: buildSearchSql(params),
        minTimestamp: params.minTimestamp,
        maxTimestamp: params.maxTimestamp,
        limit: params.limit,
        environment: params.environment,
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
        sql: params ? buildSearchSql(params) : '',
      },
    }
  },

  outputs: {
    rows: {
      type: 'array',
      description: 'Matching spans and logs, most recent first',
      items: LOGFIRE_RECORD_OUTPUT_ITEM,
    },
    rowCount: { type: 'number', description: 'Number of rows returned' },
    sql: { type: 'string', description: 'SQL query that was executed against Logfire' },
  },
}
