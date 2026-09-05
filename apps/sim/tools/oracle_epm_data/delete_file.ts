import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataDeleteFileParams,
  OracleEpmDataResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_FILE_STATUS_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataDeleteFileTool: InternalToolConfig<
  OracleEpmDataDeleteFileParams,
  OracleEpmDataResponse
> = {
  id: 'oracle_epm_data_delete_file',
  name: 'Oracle EPM Data Delete File',
  description: 'Permanently delete the specified EPM repository file or application snapshot.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Complete raw repository filename, including folders. Do not URL-encode it.',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_FILE_STATUS_OUTPUTS,
}
