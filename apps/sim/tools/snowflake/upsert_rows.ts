import { buildUpsertRows } from '@/tools/snowflake/sql'
import type { SnowflakeStatementResponse, SnowflakeUpsertRowsParams } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeBaseParams,
  snowflakeComputeParams,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const upsertRowsTool: ToolConfig<SnowflakeUpsertRowsParams, SnowflakeStatementResponse> = {
  id: 'snowflake_upsert_rows',
  version: '1.0.0',
  name: 'Snowflake Upsert Rows',
  description: 'Update matching rows and insert unmatched rows with a bound MERGE statement.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeComputeParams,
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
      description: 'Non-empty JSON array of row objects with matching keys',
    },
    matchColumns: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Columns used to match target rows',
      items: { type: 'string' },
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildUpsertRows(params), { warehouse: params.warehouse })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
