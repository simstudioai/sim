import { buildListTaskRuns } from '@/tools/snowflake/sql'
import type {
  SnowflakeListTaskRunsParams,
  SnowflakeListTaskRunsResponse,
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

export const listTaskRunsTool: ToolConfig<
  SnowflakeListTaskRunsParams,
  SnowflakeListTaskRunsResponse
> = {
  id: 'snowflake_list_task_runs',
  version: '1.0.0',
  name: 'Snowflake List Task Runs',
  description: 'Query up to seven days of Snowflake task history, capped at 10000 rows.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeContextParams,
    taskName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional task name filter',
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
    errorOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only failed task runs',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum task runs, from 1 to 10000',
    },
  },
  request: {
    url: (params) => `${normalizeSnowflakeHost(params.host)}/api/v2/statements`,
    method: 'POST',
    headers: getSnowflakeHeaders,
    body: (params) =>
      buildSnowflakeStatementBody(
        { ...params, maxRows: params.maxRows ?? params.limit },
        buildListTaskRuns(params)
      ),
  },
  transformResponse: (response, params) =>
    transformSnowflakeResponse(response, 0, params?.maxRows ?? params?.limit),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
