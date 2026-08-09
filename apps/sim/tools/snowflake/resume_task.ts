import { buildResumeTask } from '@/tools/snowflake/sql'
import type { SnowflakeStatementResponse, SnowflakeTaskParams } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeAuthParamFields,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const resumeTaskTool: ToolConfig<SnowflakeTaskParams, SnowflakeStatementResponse> = {
  id: 'snowflake_resume_task',
  version: '1.0.0',
  name: 'Snowflake Resume Task',
  description: 'Resume a suspended Snowflake task so its schedule runs again.',
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
      description: 'Task name without a database or schema prefix',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildResumeTask(params))
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
