import type {
  SnowflakeCancelStatementParams,
  SnowflakeCancelStatementResponse,
} from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  getSnowflakeHeaders,
  normalizeSnowflakeHost,
  snowflakeBaseParams,
  transformSnowflakeResponse,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const cancelStatementTool: ToolConfig<
  SnowflakeCancelStatementParams,
  SnowflakeCancelStatementResponse
> = {
  id: 'snowflake_cancel_statement',
  name: 'Snowflake Cancel Statement',
  description: 'Cancel a running Snowflake SQL API statement.',
  version: '1.0.0',
  params: {
    ...snowflakeBaseParams,
    statementHandle: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Statement handle returned by Snowflake',
    },
  },
  request: {
    url: (params) =>
      `${normalizeSnowflakeHost(params.host)}/api/v2/statements/${encodeURIComponent(params.statementHandle.trim())}/cancel`,
    method: 'POST',
    headers: getSnowflakeHeaders,
  },
  transformResponse: (response, params) =>
    transformSnowflakeResponse(response, 0, 1, true, params?.statementHandle.trim()),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
