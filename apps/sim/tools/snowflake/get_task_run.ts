import { buildGetTaskRun } from '@/tools/snowflake/sql'
import type { SnowflakeGetTaskRunParams, SnowflakeStatementResponse } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeBaseParams,
  snowflakeComputeParams,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const getTaskRunTool: ToolConfig<SnowflakeGetTaskRunParams, SnowflakeStatementResponse> = {
  id: 'snowflake_get_task_run',
  version: '1.0.0',
  name: 'Snowflake Get Task Run',
  description:
    'Find one task history record by query ID within Snowflake’s seven-day window and 10000 most recent records after optional filters.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeComputeParams,
    queryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task run query ID from TASK_HISTORY',
    },
    taskName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional task name used to narrow the 10000-record history window',
    },
    startTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional inclusive ISO timestamp within the last seven days',
    },
    endTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional exclusive ISO timestamp within the last seven days',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildGetTaskRun(params), {
      warehouse: params.warehouse,
      maxRows: 1,
    })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
