import {
  buildOracleConnectionInput,
  ORACLE_CONNECTION_PARAMS,
  ORACLE_EXECUTION_OUTPUTS,
  transformOracleExecutionResponse,
} from '@/tools/oracledb/shared'
import type { OracleInsertParams, OracleInsertResponse } from '@/tools/oracledb/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleInsertTool: InternalToolConfig<OracleInsertParams, OracleInsertResponse> = {
  id: 'oracledb_insert',
  name: 'Oracle Database Insert',
  description: 'Insert one JSON object as a row in an Oracle Database table using bound values',
  version: '1.0.0',
  params: {
    ...ORACLE_CONNECTION_PARAMS,
    schema: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional exact, case-sensitive owning schema; omit it to use the connection current schema',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Exact, case-sensitive Oracle table name; use the name returned by introspection',
    },
    data: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object whose keys are exact, case-sensitive column names and whose values are inserted with IN binds',
    },
  },
  operation: {
    input: (params) => ({
      ...buildOracleConnectionInput(params),
      ...(params.schema !== undefined ? { schema: params.schema } : {}),
      table: params.table,
      data: params.data,
    }),
  },
  transformResponse: (response) =>
    transformOracleExecutionResponse(response, {
      failure: 'Oracle Database insert failed',
      success: 'Data inserted successfully',
    }),
  outputs: {
    message: ORACLE_EXECUTION_OUTPUTS.message,
    rows: ORACLE_EXECUTION_OUTPUTS.rows,
    rowCount: ORACLE_EXECUTION_OUTPUTS.rowCount,
    truncated: ORACLE_EXECUTION_OUTPUTS.truncated,
    truncationReason: ORACLE_EXECUTION_OUTPUTS.truncationReason,
  },
}
