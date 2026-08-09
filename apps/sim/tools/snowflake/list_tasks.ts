import { buildListTasks } from '@/tools/snowflake/sql'
import type { SnowflakeListTasksParams, SnowflakeStatementResponse } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeAuthParamFields,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const listTasksTool: ToolConfig<SnowflakeListTasksParams, SnowflakeStatementResponse> = {
  id: 'snowflake_list_tasks',
  version: '1.0.0',
  name: 'Snowflake List Tasks',
  description: 'List tasks in a Snowflake schema.',
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
    nameLike: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional SQL LIKE pattern for task names',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum task rows, from 1 to 10000',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildListTasks(params), { maxRows: params.limit })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
