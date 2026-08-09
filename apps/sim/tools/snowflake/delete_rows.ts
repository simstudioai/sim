import { buildDeleteRows } from '@/tools/snowflake/sql'
import type { SnowflakeDeleteRowsParams, SnowflakeStatementResponse } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeAuthParamFields,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * The block resolves `filters` to JSON before execution, but a direct tool call can still
 * deliver the raw JSON string.
 */
function parseFilters(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return value as Record<string, unknown>
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    throw new Error('filters must be a JSON object of column filters')
  }
}

export const deleteRowsTool: ToolConfig<SnowflakeDeleteRowsParams, SnowflakeStatementResponse> = {
  id: 'snowflake_delete_rows',
  version: '1.0.0',
  name: 'Snowflake Delete Rows',
  description: 'Delete rows matching a required set of bound column filters.',
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
    filters: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Non-empty JSON object of column filters combined with AND. A null value matches rows where that column IS NULL; every other value is compared for equality against a bound parameter.',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(
      params,
      buildDeleteRows({ ...params, filters: parseFilters(params.filters) }),
      { warehouse: params.warehouse }
    )
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
