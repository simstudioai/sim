import { buildGetTaskRunOutput } from '@/tools/snowflake/sql'
import type {
  SnowflakeGetTaskRunOutputParams,
  SnowflakeStatementResponse,
} from '@/tools/snowflake/types'
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

export const getTaskRunOutputTool: ToolConfig<
  SnowflakeGetTaskRunOutputParams,
  SnowflakeStatementResponse
> = {
  id: 'snowflake_get_task_run_output',
  version: '1.0.0',
  name: 'Snowflake Get Task Run Output',
  description:
    'Read a task query result with RESULT_SCAN during Snowflake’s 24-hour retention window using the task owner role.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeComputeParams,
    ...snowflakeMaxRowsParam,
    queryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Completed task query ID; task results require the task owner role, while manual query results require the same user',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildGetTaskRunOutput(params), {
      warehouse: params.warehouse,
      maxRows: params.maxRows,
    })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
