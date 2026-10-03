import {
  buildOracleConnectionInput,
  ORACLE_CONNECTION_PARAMS,
  ORACLE_EXECUTION_OUTPUTS,
  transformOracleExecutionResponse,
} from '@/tools/oracledb/shared'
import type { OracleDeleteParams, OracleDeleteResponse } from '@/tools/oracledb/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleDeleteTool: InternalToolConfig<OracleDeleteParams, OracleDeleteResponse> = {
  id: 'oracledb_delete',
  name: 'Oracle Database Delete',
  description: 'Delete Oracle Database rows selected by a required WHERE expression',
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
      where: params.where,
    }),
  },
  transformResponse: (response) =>
    transformOracleExecutionResponse(response, {
      failure: 'Oracle Database delete failed',
      success: 'Data deleted successfully',
    }),
  outputs: {
    message: ORACLE_EXECUTION_OUTPUTS.message,
    rows: ORACLE_EXECUTION_OUTPUTS.rows,
    rowCount: ORACLE_EXECUTION_OUTPUTS.rowCount,
    truncated: ORACLE_EXECUTION_OUTPUTS.truncated,
    truncationReason: ORACLE_EXECUTION_OUTPUTS.truncationReason,
  },
}
