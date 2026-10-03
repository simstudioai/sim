import {
  buildOracleConnectionInput,
  ORACLE_CONNECTION_PARAMS,
  ORACLE_EXECUTION_OUTPUTS,
  transformOracleExecutionResponse,
} from '@/tools/oracledb/shared'
import type { OracleQueryParams, OracleQueryResponse } from '@/tools/oracledb/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleQueryTool: InternalToolConfig<OracleQueryParams, OracleQueryResponse> = {
  id: 'oracledb_query',
  name: 'Oracle Database Query',
  description:
    'Run one read-only Oracle SELECT statement or ordinary SELECT CTE with optional named IN binds',
  version: '1.0.0',
  params: {
    ...ORACLE_CONNECTION_PARAMS,
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'One Oracle SELECT statement without a trailing semicolon. Mutating statements, SELECT FOR UPDATE, sequence changes, database links, comments, hints, and PL/SQL are rejected.',
    },
    binds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional named IN bind values keyed without the colon prefix; values may be strings, finite numbers, or null',
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
      failure: 'Oracle Database query failed',
      success: 'Query executed successfully',
    }),
  outputs: {
    message: ORACLE_EXECUTION_OUTPUTS.message,
    rows: ORACLE_EXECUTION_OUTPUTS.rows,
    rowCount: ORACLE_EXECUTION_OUTPUTS.rowCount,
    truncated: ORACLE_EXECUTION_OUTPUTS.truncated,
    truncationReason: ORACLE_EXECUTION_OUTPUTS.truncationReason,
  },
}
