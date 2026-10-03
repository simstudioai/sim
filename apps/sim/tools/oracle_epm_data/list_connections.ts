import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataListConnectionsParams,
  OracleEpmDataResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_CONNECTIONS_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataListConnectionsTool: InternalToolConfig<
  OracleEpmDataListConnectionsParams,
  OracleEpmDataResponse
> = {
  id: 'oracle_epm_data_list_connections',
  name: 'Oracle EPM Data List Connections',
  description: 'List documented Data Integration connection names.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_CONNECTIONS_OUTPUTS,
}
