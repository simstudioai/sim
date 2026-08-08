import { buildDeleteRows } from '@/tools/snowflake/sql'
import type { SnowflakeDeleteRowsParams, SnowflakeStatementResponse } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeBaseParams,
  snowflakeComputeParams,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteRowsTool: ToolConfig<SnowflakeDeleteRowsParams, SnowflakeStatementResponse> = {
  id: 'snowflake_delete_rows',
  version: '1.0.0',
  name: 'Snowflake Delete Rows',
  description: 'Delete rows matching a required set of bound equality filters.',
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
    filters: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Non-empty JSON object of column equality filters combined with AND',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildDeleteRows(params), { warehouse: params.warehouse })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
