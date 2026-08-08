import { buildRunTask } from '@/tools/snowflake/sql'
import type { SnowflakeRunTaskParams, SnowflakeStatementResponse } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeBaseParams,
  snowflakeStatementParams,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const runTaskTool: ToolConfig<SnowflakeRunTaskParams, SnowflakeStatementResponse> = {
  id: 'snowflake_run_task',
  version: '1.0.0',
  name: 'Snowflake Run Task',
  description: 'Run a Snowflake task immediately, optionally retrying its last failed graph.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeStatementParams,
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
    taskName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task name',
    },
    retryLast: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Retry the last failed task graph run',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildRunTask(params), { maxRows: 1 })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
