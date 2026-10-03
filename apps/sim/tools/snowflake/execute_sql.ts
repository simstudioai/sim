import { normalizeBindings } from '@/tools/snowflake/sql'
import type {
  SnowflakeBinding,
  SnowflakeExecuteSqlParams,
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
 * The block resolves `bindings` to JSON before execution, but a direct tool call can
 * still deliver the raw JSON string.
 */
function parseBindings(value: unknown): Record<string, SnowflakeBinding> | undefined {
  if (typeof value !== 'string') return value as Record<string, SnowflakeBinding> | undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed) as Record<string, SnowflakeBinding>
  } catch {
    throw new Error('bindings must be a JSON object keyed by 1-based positions')
  }
}

/** Only a real `true` or the exact string `"true"` submits the statement asynchronously. */
function isAsync(value: unknown): boolean {
  return value === true || value === 'true'
}

export const executeSqlTool: ToolConfig<SnowflakeExecuteSqlParams, SnowflakeStatementResponse> = {
  id: 'snowflake_execute_sql',
  version: '1.0.0',
  name: 'Snowflake Execute SQL',
  description: 'Execute one parameterized SQL statement through the Snowflake SQL API.',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Database context for this statement',
    },
    schema: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Schema context for this statement',
    },
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
  request: snowflakeStatementRequest(
    (params) =>
      buildSnowflakeStatementBody(
        params,
        {
          statement: params.statement,
          bindings: normalizeBindings(parseBindings(params.bindings)),
        },
        {
          context: { database: params.database, schema: params.schema },
          warehouse: params.warehouse,
          maxRows: params.maxRows,
        }
      ),
    (params) => isAsync(params.async)
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
