import { buildGetTaskRunOutput } from '@/tools/snowflake/sql'
import type {
  SnowflakeGetTaskRunOutputParams,
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
    maxRows: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum result rows; defaults to 1000 with a Sim safety limit of 10000',
    },
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
