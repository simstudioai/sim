import { buildGetTask } from '@/tools/snowflake/sql'
import type { SnowflakeStatementResponse, SnowflakeTaskParams } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeBaseParams,
  snowflakeStatementParams,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const getTaskTool: ToolConfig<SnowflakeTaskParams, SnowflakeStatementResponse> = {
  id: 'snowflake_get_task',
  version: '1.0.0',
  name: 'Snowflake Get Task',
  description: 'Describe a Snowflake task.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeStatementParams,
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
      description: 'Task name',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildGetTask(params), { maxRows: 1 })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
