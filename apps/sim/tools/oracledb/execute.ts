import {
  buildOracleConnectionInput,
  ORACLE_CONNECTION_PARAMS,
  ORACLE_EXECUTION_OUTPUTS,
  transformOracleExecutionResponse,
} from '@/tools/oracledb/shared'
import type { OracleExecuteParams, OracleExecuteResponse } from '@/tools/oracledb/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleExecuteTool: InternalToolConfig<OracleExecuteParams, OracleExecuteResponse> = {
  id: 'oracledb_execute',
  name: 'Oracle Database Execute',
  description:
    'Execute one allowed Oracle SQL statement: SELECT, INSERT, UPDATE, DELETE, MERGE, CREATE, ALTER, DROP, or EXPLAIN PLAN',
  version: '1.0.0',
  params: {
    ...ORACLE_CONNECTION_PARAMS,
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'One allowed Oracle SQL statement without a trailing semicolon. SELECT FOR UPDATE, PL/SQL, transaction control, OUT binds, RETURNING INTO, and stacked statements are rejected.',
    },
    binds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional named IN bind values keyed without the colon prefix; values may be strings, finite numbers, or null. Oracle does not allow bind variables in DDL.',
    },
  },
  operation: {
    input: (params) => ({
      ...buildOracleConnectionInput(params),
      query: params.query,
      ...(params.binds !== undefined ? { binds: params.binds } : {}),
    }),
  },
  transformResponse: (response) =>
    transformOracleExecutionResponse(response, {
      failure: 'Oracle Database statement failed',
      success: 'SQL executed successfully',
    }),
  outputs: {
    message: ORACLE_EXECUTION_OUTPUTS.message,
    rows: ORACLE_EXECUTION_OUTPUTS.rows,
    rowCount: ORACLE_EXECUTION_OUTPUTS.rowCount,
    truncated: ORACLE_EXECUTION_OUTPUTS.truncated,
    truncationReason: ORACLE_EXECUTION_OUTPUTS.truncationReason,
  },
}
