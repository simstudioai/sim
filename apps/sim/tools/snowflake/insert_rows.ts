import { buildInsertRows } from '@/tools/snowflake/sql'
import type { SnowflakeInsertRowsParams, SnowflakeStatementResponse } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeBaseParams,
  snowflakeComputeParams,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const insertRowsTool: ToolConfig<SnowflakeInsertRowsParams, SnowflakeStatementResponse> = {
  id: 'snowflake_insert_rows',
  version: '1.0.0',
  name: 'Snowflake Insert Rows',
  description: 'Insert structured JSON rows using bound values.',
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
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildInsertRows(params), { warehouse: params.warehouse })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
