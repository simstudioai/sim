import { buildListTasks } from '@/tools/snowflake/sql'
import type { SnowflakeListTasksParams, SnowflakeListTasksResponse } from '@/tools/snowflake/types'
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

export const listTasksTool: ToolConfig<SnowflakeListTasksParams, SnowflakeListTasksResponse> = {
  id: 'snowflake_list_tasks',
  version: '1.0.0',
  name: 'Snowflake List Tasks',
  description: 'List tasks in a Snowflake schema.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeContextParams,
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
    nameLike: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional SQL LIKE pattern for task names',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum task rows, from 1 to 10000',
    },
  },
  request: {
    url: (params) => `${normalizeSnowflakeHost(params.host)}/api/v2/statements`,
    method: 'POST',
    headers: getSnowflakeHeaders,
    body: (params) =>
      buildSnowflakeStatementBody(
        { ...params, maxRows: params.maxRows ?? params.limit },
        buildListTasks(params)
      ),
  },
  transformResponse: (response, params) =>
    transformSnowflakeResponse(response, 0, params?.maxRows ?? params?.limit),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
