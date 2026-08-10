import { buildUpsertRows } from '@/tools/snowflake/sql'
import type { SnowflakeStatementResponse, SnowflakeUpsertRowsParams } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeAuthParamFields,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * The block resolves `rows` to JSON before execution, but a direct tool call can still
 * deliver the raw JSON string. Values that already arrive parsed pass straight through
 * to the builder's own shape validation.
 */
function parseRows(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== 'string') return value as Array<Record<string, unknown>>
  try {
    return JSON.parse(value) as Array<Record<string, unknown>>
  } catch {
    throw new Error('rows must be a JSON array of row objects')
  }
}

/** Accepts `matchColumns` as a JSON string from a direct tool call. */
function parseMatchColumns(value: unknown): string[] {
  if (typeof value !== 'string') return value as string[]
  try {
    return JSON.parse(value) as string[]
  } catch {
    throw new Error('matchColumns must be a JSON array of column names')
  }
}

export const upsertRowsTool: ToolConfig<SnowflakeUpsertRowsParams, SnowflakeStatementResponse> = {
  id: 'snowflake_upsert_rows',
  version: '1.0.0',
  name: 'Snowflake Upsert Rows',
  description: 'Update matching rows and insert unmatched rows with a bound MERGE statement.',
  params: {
    ...snowflakeAuthParamFields,
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Snowflake role to use for this statement',
    },
    statementTimeoutSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Statement timeout in seconds; 0 uses Snowflake maximum of 604800 seconds',
    },
    warehouse: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Warehouse to use for this statement; defaults to the PAT user setting',
    },
    database: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Database name',
    },
    schema: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Schema name',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target Snowflake table name within the selected database and schema context',
    },
    rows: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Non-empty JSON array of row objects with matching keys. For bulk loads, stage the files and use Load Data instead.',
    },
    matchColumns: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Columns used to match target rows. Match values must be non-null and unique across the submitted rows.',
      items: { type: 'string' },
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(
      params,
      buildUpsertRows({
        ...params,
        rows: parseRows(params.rows),
        matchColumns: parseMatchColumns(params.matchColumns),
      }),
      { warehouse: params.warehouse }
    )
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
