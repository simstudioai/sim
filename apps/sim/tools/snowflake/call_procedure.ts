import { buildCallProcedure } from '@/tools/snowflake/sql'
import type {
  SnowflakeBinding,
  SnowflakeCallProcedureParams,
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

/**
 * The block resolves `procedureArguments` to JSON before execution, but a direct tool call
 * can still deliver the raw JSON string.
 */
function parseProcedureArguments(value: unknown): SnowflakeBinding[] | undefined {
  if (typeof value !== 'string') return value as SnowflakeBinding[] | undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed) as SnowflakeBinding[]
  } catch {
    throw new Error('procedureArguments must be a JSON array of type and value objects')
  }
}

export const callProcedureTool: ToolConfig<
  SnowflakeCallProcedureParams,
  SnowflakeStatementResponse
> = {
  id: 'snowflake_call_procedure',
  version: '1.0.0',
  name: 'Snowflake Call Procedure',
  description: 'Call a stored procedure with explicitly typed Snowflake bindings.',
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
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(
      params,
      buildCallProcedure({
        ...params,
        procedureArguments: parseProcedureArguments(params.procedureArguments),
      }),
      {
        warehouse: params.warehouse,
        maxRows: params.maxRows,
      }
    )
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
