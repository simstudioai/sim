import {
  buildOracleConnectionInput,
  ORACLE_CONNECTION_PARAMS,
  ORACLE_EXECUTION_OUTPUTS,
  transformOracleExecutionResponse,
} from '@/tools/oracledb/shared'
import type { OracleUpdateParams, OracleUpdateResponse } from '@/tools/oracledb/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleUpdateTool: InternalToolConfig<OracleUpdateParams, OracleUpdateResponse> = {
  id: 'oracledb_update',
  name: 'Oracle Database Update',
  description:
    'Update Oracle Database rows selected by a required WHERE expression, using bound values for changed columns',
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
        'JSON object whose keys are exact, case-sensitive column names and whose values are assigned with IN binds',
    },
    where: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Non-empty WHERE expression without the WHERE keyword',
    },
  },
  operation: {
    input: (params) => ({
      ...buildOracleConnectionInput(params),
      ...(params.schema !== undefined ? { schema: params.schema } : {}),
      table: params.table,
      data: params.data,
      where: params.where,
    }),
  },
  transformResponse: (response) =>
    transformOracleExecutionResponse(response, {
      failure: 'Oracle Database update failed',
      success: 'Data updated successfully',
    }),
  outputs: {
    message: ORACLE_EXECUTION_OUTPUTS.message,
    rows: ORACLE_EXECUTION_OUTPUTS.rows,
    rowCount: ORACLE_EXECUTION_OUTPUTS.rowCount,
    truncated: ORACLE_EXECUTION_OUTPUTS.truncated,
    truncationReason: ORACLE_EXECUTION_OUTPUTS.truncationReason,
  },
}
