import { normalizeBindings } from '@/tools/snowflake/sql'
import type { SnowflakeExecuteSqlParams, SnowflakeStatementResponse } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeBaseParams,
  snowflakeComputeParams,
  snowflakeMaxRowsParam,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const executeSqlTool: ToolConfig<SnowflakeExecuteSqlParams, SnowflakeStatementResponse> = {
  id: 'snowflake_execute_sql',
  version: '1.0.0',
  name: 'Snowflake Execute SQL',
  description: 'Execute one parameterized SQL statement through the Snowflake SQL API.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeComputeParams,
    ...snowflakeMaxRowsParam,
    database: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Database context for this statement',
    },
    schema: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Schema context for this statement',
    },
    statement: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'One Snowflake SQL statement to execute',
    },
    bindings: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Snowflake bindings keyed by 1-based position, each with type and string value',
    },
    async: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return immediately with a statement handle',
    },
  },
  request: snowflakeStatementRequest(
    (params) =>
      buildSnowflakeStatementBody(
        params,
        {
          statement: params.statement,
          bindings: normalizeBindings(params.bindings),
        },
        {
          context: { database: params.database, schema: params.schema },
          warehouse: params.warehouse,
          maxRows: params.maxRows,
        }
      ),
    (params) => params.async === true
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
