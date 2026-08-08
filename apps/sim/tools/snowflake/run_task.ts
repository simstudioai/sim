import { buildRunTask } from '@/tools/snowflake/sql'
import type { SnowflakeRunTaskParams, SnowflakeRunTaskResponse } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  getSnowflakeHeaders,
  normalizeSnowflakeHost,
  snowflakeBaseParams,
  snowflakeContextParams,
  transformSnowflakeResponse,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const runTaskTool: ToolConfig<SnowflakeRunTaskParams, SnowflakeRunTaskResponse> = {
  id: 'snowflake_run_task',
  version: '1.0.0',
  name: 'Snowflake Run Task',
  description: 'Run a Snowflake task immediately, optionally retrying its last failed graph.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeContextParams,
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
  request: {
    url: (params) => `${normalizeSnowflakeHost(params.host)}/api/v2/statements`,
    method: 'POST',
    headers: getSnowflakeHeaders,
    body: (params) => buildSnowflakeStatementBody(params, buildRunTask(params)),
  },
  transformResponse: (response, params) => transformSnowflakeResponse(response, 0, params?.maxRows),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
