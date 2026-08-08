import { buildCancelTaskRun } from '@/tools/snowflake/sql'
import type {
  SnowflakeCancelTaskRunParams,
  SnowflakeStatementResponse,
} from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeBaseParams,
  snowflakeComputeParams,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const cancelTaskRunTool: ToolConfig<
  SnowflakeCancelTaskRunParams,
  SnowflakeStatementResponse
> = {
  id: 'snowflake_cancel_task_run',
  version: '1.0.0',
  name: 'Snowflake Cancel Task Run',
  description: 'Cancel a running task query with SYSTEM$CANCEL_QUERY.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeComputeParams,
    queryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Running task query ID from TASK_HISTORY',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildCancelTaskRun(params), {
      warehouse: params.warehouse,
      maxRows: 1,
    })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
