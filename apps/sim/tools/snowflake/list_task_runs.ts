import { buildListTaskRuns } from '@/tools/snowflake/sql'
import type {
  SnowflakeListTaskRunsParams,
  SnowflakeStatementResponse,
} from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeAuthParamFields,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * TASK_HISTORY's ERROR_ONLY argument is rendered from this value, so only a real `true`
 * or the exact string `"true"` narrows the history to failed and cancelled runs.
 */
function isErrorOnly(value: unknown): boolean {
  return value === true || value === 'true'
}

export const listTaskRunsTool: ToolConfig<SnowflakeListTaskRunsParams, SnowflakeStatementResponse> =
  {
    id: 'snowflake_list_task_runs',
    version: '1.0.0',
    name: 'Snowflake List Task Runs',
    description: 'Query up to seven days of Snowflake task history, capped at 10000 rows.',
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
      warehouse: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Warehouse to use for this statement; defaults to the PAT user setting',
      },
      taskName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Optional task name filter. TASK_HISTORY supports only non-qualified task names, so pass DAILY_LOAD rather than DB.SCHEMA.DAILY_LOAD',
      },
      startTime: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Optional scheduled-time range start as an ISO timestamp within the last seven days',
      },
      endTime: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Optional scheduled-time range end as an ISO timestamp within the last seven days',
      },
      errorOnly: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Return only task runs that failed or were cancelled',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum task runs, from 1 to 10000',
      },
    },
    request: snowflakeStatementRequest((params) =>
      buildSnowflakeStatementBody(
        params,
        buildListTaskRuns({ ...params, errorOnly: isErrorOnly(params.errorOnly) }),
        {
          warehouse: params.warehouse,
          maxRows: params.limit,
        }
      )
    ),
    transformResponse: transformSnowflakeResult(),
    outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
  }
