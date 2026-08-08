import { buildCallProcedure } from '@/tools/snowflake/sql'
import type {
  SnowflakeCallProcedureParams,
  SnowflakeCallProcedureResponse,
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

export const callProcedureTool: ToolConfig<
  SnowflakeCallProcedureParams,
  SnowflakeCallProcedureResponse
> = {
  id: 'snowflake_call_procedure',
  version: '1.0.0',
  name: 'Snowflake Call Procedure',
  description: 'Call a stored procedure with explicitly typed Snowflake bindings.',
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
    procedureName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stored procedure name',
    },
    procedureArguments: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ordered argument bindings with a Snowflake type and string value',
      items: {
        type: 'object',
        required: ['type', 'value'],
        additionalProperties: false,
        properties: {
          type: { type: 'string', description: 'Snowflake binding type' },
          value: { type: 'string', description: 'Snowflake binding value' },
        },
      },
    },
  },
  request: {
    url: (params) => `${normalizeSnowflakeHost(params.host)}/api/v2/statements`,
    method: 'POST',
    headers: getSnowflakeHeaders,
    body: (params) => buildSnowflakeStatementBody(params, buildCallProcedure(params)),
  },
  transformResponse: (response, params) => transformSnowflakeResponse(response, 0, params?.maxRows),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
