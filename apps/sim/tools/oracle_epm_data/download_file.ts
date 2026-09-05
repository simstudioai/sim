import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataDownloadFileParams,
  OracleEpmDataResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_DOWNLOAD_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataDownloadFileTool: InternalToolConfig<
  OracleEpmDataDownloadFileParams,
  OracleEpmDataResponse
> = {
  id: 'oracle_epm_data_download_file',
  name: 'Oracle EPM Data Download File',
  description:
    "Download an EPM repository file of at most 100 MiB into this workflow's execution storage.",
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
  outputs: ORACLE_EPM_DATA_DOWNLOAD_OUTPUTS,
}
