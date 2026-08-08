import { buildGetTaskRunOutput } from '@/tools/snowflake/sql'
import type {
  SnowflakeGetTaskRunOutputResponse,
  SnowflakeTaskRunParams,
} from '@/tools/snowflake/types'
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

export const getTaskRunOutputTool: ToolConfig<
  SnowflakeTaskRunParams,
  SnowflakeGetTaskRunOutputResponse
> = {
  id: 'snowflake_get_task_run_output',
  version: '1.0.0',
  name: 'Snowflake Get Task Run Output',
  description:
    'Read a task query result with RESULT_SCAN during Snowflake’s 24-hour retention window using the task owner role.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeContextParams,
    queryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Completed task query ID; task results require the task owner role, while manual query results require the same user',
    },
  },
  request: {
    url: (params) => `${normalizeSnowflakeHost(params.host)}/api/v2/statements`,
    method: 'POST',
    headers: getSnowflakeHeaders,
    body: (params) => buildSnowflakeStatementBody(params, buildGetTaskRunOutput(params)),
  },
  transformResponse: (response, params) => transformSnowflakeResponse(response, 0, params?.maxRows),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
