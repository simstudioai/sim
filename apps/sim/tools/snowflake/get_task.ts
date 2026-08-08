import { buildGetTask } from '@/tools/snowflake/sql'
import type { SnowflakeGetTaskResponse, SnowflakeTaskParams } from '@/tools/snowflake/types'
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

export const getTaskTool: ToolConfig<SnowflakeTaskParams, SnowflakeGetTaskResponse> = {
  id: 'snowflake_get_task',
  version: '1.0.0',
  name: 'Snowflake Get Task',
  description: 'Describe a Snowflake task.',
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
  },
  request: {
    url: (params) => `${normalizeSnowflakeHost(params.host)}/api/v2/statements`,
    method: 'POST',
    headers: getSnowflakeHeaders,
    body: (params) => buildSnowflakeStatementBody(params, buildGetTask(params)),
  },
  transformResponse: (response, params) => transformSnowflakeResponse(response, 0, params?.maxRows),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
