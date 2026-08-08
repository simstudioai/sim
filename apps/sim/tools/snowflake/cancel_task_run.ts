import { buildCancelTaskRun } from '@/tools/snowflake/sql'
import type {
  SnowflakeCancelTaskRunParams,
  SnowflakeStatementResponse,
} from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
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
  name: 'Snowflake Cancel Task Query',
  description:
    'Cancel one running task query by query ID with SYSTEM$CANCEL_QUERY. Other tasks in the same task graph keep running and must be cancelled separately.',
  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Snowflake account host, for example myorg-myaccount.snowflakecomputing.com',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Snowflake programmatic access token',
    },
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
      description:
        'Query ID of the single running task query to cancel, taken from TASK_HISTORY. Cancels only that query.',
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
