import { buildCancelTaskRun } from '@/tools/snowflake/sql'
import type {
  SnowflakeCancelTaskRunResponse,
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

export const cancelTaskRunTool: ToolConfig<SnowflakeTaskRunParams, SnowflakeCancelTaskRunResponse> =
  {
    id: 'snowflake_cancel_task_run',
    version: '1.0.0',
    name: 'Snowflake Cancel Task Run',
    description: 'Cancel a running task query with SYSTEM$CANCEL_QUERY.',
    params: {
      ...snowflakeBaseParams,
      ...snowflakeContextParams,
      queryId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Running task query ID from TASK_HISTORY',
      },
    },
    request: {
      url: (params) => `${normalizeSnowflakeHost(params.host)}/api/v2/statements`,
      method: 'POST',
      headers: getSnowflakeHeaders,
      body: (params) => buildSnowflakeStatementBody(params, buildCancelTaskRun(params)),
    },
    transformResponse: (response, params) =>
      transformSnowflakeResponse(response, 0, params?.maxRows),
    outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
  }
