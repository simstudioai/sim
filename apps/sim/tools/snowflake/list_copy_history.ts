import { buildListCopyHistory } from '@/tools/snowflake/sql'
import type {
  SnowflakeListCopyHistoryParams,
  SnowflakeStatementResponse,
} from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeAuthParamFields,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const listCopyHistoryTool: ToolConfig<
  SnowflakeListCopyHistoryParams,
  SnowflakeStatementResponse
> = {
  id: 'snowflake_list_copy_history',
  version: '1.0.0',
  name: 'Snowflake List Copy History',
  description: 'List staged-file load results for a table over the last fourteen days.',
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
      description: 'Table whose load history to return',
    },
    startTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ISO-8601 start of the load window, within the last fourteen days',
    },
    endTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO-8601 end of the load window, within the last fourteen days; defaults to now',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum load rows, from 1 to 10000',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildListCopyHistory(params), {
      warehouse: params.warehouse,
      maxRows: params.limit,
    })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
