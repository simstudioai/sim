import { buildRunTask } from '@/tools/snowflake/sql'
import type { SnowflakeRunTaskParams, SnowflakeStatementResponse } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeAuthParamFields,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Only a real `true` or the exact string `"true"` appends RETRY LAST, so a direct tool
 * call supplying the truthy string `"false"` cannot re-run a failed task graph.
 */
function isRetryLast(value: unknown): boolean {
  return value === true || value === 'true'
}

export const runTaskTool: ToolConfig<SnowflakeRunTaskParams, SnowflakeStatementResponse> = {
  id: 'snowflake_run_task',
  version: '1.0.0',
  name: 'Snowflake Run Task',
  description: 'Run a Snowflake task immediately, optionally retrying its last failed graph.',
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
    buildSnowflakeStatementBody(
      params,
      buildRunTask({ ...params, retryLast: isRetryLast(params.retryLast) }),
      { maxRows: 1 }
    )
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
