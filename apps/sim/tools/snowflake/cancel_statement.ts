import type {
  SnowflakeCancelStatementParams,
  SnowflakeStatementResponse,
} from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  getSnowflakeBaseUrl,
  getSnowflakeHeaders,
  snowflakeAuthParamFields,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const cancelStatementTool: ToolConfig<
  SnowflakeCancelStatementParams,
  SnowflakeStatementResponse
> = {
  id: 'snowflake_cancel_statement',
  name: 'Snowflake Cancel Statement',
  description: 'Cancel a running Snowflake SQL API statement.',
  version: '1.0.0',
  params: {
    ...snowflakeAuthParamFields,
    statementHandle: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Statement handle returned by Snowflake',
    },
  },
  request: {
    url: (params) =>
      `${getSnowflakeBaseUrl(params)}/api/v2/statements/${encodeURIComponent(params.statementHandle.trim())}/cancel`,
    method: 'POST',
    headers: getSnowflakeHeaders,
  },
  transformResponse: transformSnowflakeResult((params) => ({
    canceled: true,
    fallbackStatementHandle: params?.statementHandle.trim(),
  })),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
