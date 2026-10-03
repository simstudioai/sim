import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataListFilesParams,
  OracleEpmDataResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_FILES_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataListFilesTool: InternalToolConfig<
  OracleEpmDataListFilesParams,
  OracleEpmDataResponse
> = {
  id: 'oracle_epm_data_list_files',
  name: 'Oracle EPM Data List Files',
  description:
    'List EPM repository files and application snapshots with documented size and modification metadata.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_FILES_OUTPUTS,
}
