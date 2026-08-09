import { buildListQueryHistory } from '@/tools/snowflake/sql'
import type {
  SnowflakeListQueryHistoryParams,
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

export const listQueryHistoryTool: ToolConfig<
  SnowflakeListQueryHistoryParams,
  SnowflakeStatementResponse
> = {
  id: 'snowflake_list_query_history',
  version: '1.0.0',
  name: 'Snowflake List Query History',
  description: 'List queries that completed in the last seven days, optionally filtered.',
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
    userName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only queries run by this user; cannot be combined with warehouseName',
    },
    warehouseName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only queries run on this warehouse; cannot be combined with userName',
    },
    startTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO-8601 start of the query completion window, within the last seven days',
    },
    endTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO-8601 end of the query completion window, within the last seven days',
    },
    errorOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to return only queries that failed (execution status FAILED_WITH_ERROR or FAILED_WITH_INCIDENT). Snowflake applies the limit before this filter, so it selects the failures among the most recent queries rather than the most recent failures',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum query rows, from 1 to 10000',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildListQueryHistory(params), {
      warehouse: params.warehouse,
      maxRows: params.limit,
    })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
