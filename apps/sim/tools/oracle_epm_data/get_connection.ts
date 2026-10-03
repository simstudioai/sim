import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataGetConnectionParams,
  OracleEpmDataResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_CONNECTION_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataGetConnectionTool: InternalToolConfig<
  OracleEpmDataGetConnectionParams,
  OracleEpmDataResponse
> = {
  id: 'oracle_epm_data_get_connection',
  name: 'Oracle EPM Data Get Connection',
  description: 'Read a Data Integration source-system connection and its Oracle-returned options.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    connectionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact Data Integration connection name',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_CONNECTION_OUTPUTS,
}
