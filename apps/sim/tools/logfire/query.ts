import type {
  LogfireQueryApiResponse,
  LogfireQueryParams,
  LogfireQueryResponse,
} from '@/tools/logfire/types'
import {
  buildLogfireQueryBody,
  extractLogfireColumns,
  extractLogfireRows,
  LOGFIRE_QUERY_PATH,
  logfireHeaders,
  logfireUrl,
  parseLogfireResponse,
} from '@/tools/logfire/utils'
import type { ToolConfig } from '@/tools/types'

export const logfireQueryTool: ToolConfig<LogfireQueryParams, LogfireQueryResponse> = {
  id: 'logfire_query',
  name: 'Logfire Query',
  description:
    'Run a read-only SQL query against Logfire traces, logs, and metrics. Reads the records and metrics tables using PostgreSQL-compatible syntax.',
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
    sql: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SQL SELECT query to run against the records or metrics table',
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
      description: 'Maximum rows to return. Logfire defaults to 100 and caps at 10000.',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'IANA timezone used to evaluate the query, for example Europe/Paris',
    },
    environment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict results to a single deployment environment',
    },
  },

  request: {
    url: (params) => logfireUrl(params, LOGFIRE_QUERY_PATH),
    method: 'POST',
    headers: (params) => logfireHeaders(params.apiKey),
    body: (params) =>
      buildLogfireQueryBody({
        sql: params.sql,
        minTimestamp: params.minTimestamp,
        maxTimestamp: params.maxTimestamp,
        limit: params.limit,
        timezone: params.timezone,
        environment: params.environment,
      }),
  },

  transformResponse: async (response) => {
    const results = await parseLogfireResponse<LogfireQueryApiResponse>(response)
    const rows = extractLogfireRows(results)

    return {
      success: true,
      output: {
        rows,
        columns: extractLogfireColumns(results),
        rowCount: rows.length,
      },
    }
  },

  outputs: {
    rows: {
      type: 'array',
      description: 'Result rows. Row fields depend on the query projection.',
      items: { type: 'object', description: 'A single result row' },
    },
    columns: {
      type: 'array',
      description: 'Column metadata for the result set',
      items: {
        type: 'object',
        description: 'Column metadata',
        properties: {
          name: { type: 'string', description: 'Column name', nullable: true },
          datatype: { type: 'json', description: 'Arrow datatype of the column' },
          nullable: {
            type: 'boolean',
            description: 'Whether the column is nullable',
            nullable: true,
          },
        },
      },
    },
    rowCount: { type: 'number', description: 'Number of rows returned' },
  },
}
