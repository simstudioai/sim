import { normalizeBindings } from '@/tools/snowflake/sql'
import type {
  SnowflakeExecuteSqlParams,
  SnowflakeExecuteSqlResponse,
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

export const executeSqlTool: ToolConfig<SnowflakeExecuteSqlParams, SnowflakeExecuteSqlResponse> = {
  id: 'snowflake_execute_sql',
  version: '1.0.0',
  name: 'Snowflake Execute SQL',
  description: 'Execute one parameterized SQL statement through the Snowflake SQL API.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeContextParams,
    statement: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'One Snowflake SQL statement to execute',
    },
    bindings: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Snowflake bindings keyed by 1-based position, each with type and string value',
    },
    async: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return immediately with a statement handle',
    },
  },
  request: {
    url: (params) =>
      `${normalizeSnowflakeHost(params.host)}/api/v2/statements${params.async === true ? '?async=true' : ''}`,
    method: 'POST',
    headers: getSnowflakeHeaders,
    body: (params) =>
      buildSnowflakeStatementBody(params, {
        statement: params.statement,
        bindings: normalizeBindings(params.bindings),
      }),
  },
  transformResponse: (response, params) => transformSnowflakeResponse(response, 0, params?.maxRows),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
