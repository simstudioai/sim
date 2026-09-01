import { buildGetTaskRun } from '@/tools/snowflake/sql'
import type { SnowflakeGetTaskRunParams, SnowflakeStatementResponse } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeAuthParamFields,
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
      description:
        'Optional task name used to narrow the 10000-record history window. TASK_HISTORY supports only non-qualified task names, so pass DAILY_LOAD rather than DB.SCHEMA.DAILY_LOAD',
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
