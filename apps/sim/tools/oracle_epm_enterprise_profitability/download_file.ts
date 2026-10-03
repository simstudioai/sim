import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmDownloadFileParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_DOWNLOAD_FILE_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmDownloadFileTool: InternalToolConfig<
  OracleEpcmDownloadFileParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_download_file',
  name: 'Oracle EPCM Download File',
  description:
    'Download one ordinary repository file, at most 100 MB, into Sim execution storage. Requires trusted workspace/workflow/execution context.',
  version: '1.0.0',
  oauth: oracleEpcmOAuth,
  params: {
    ...oracleEpcmAuthParams,

    fileName: {
      type: 'string',
      required: true,
      description: 'Raw repository filename, including ordinary folders; do not URL-encode it',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_DOWNLOAD_FILE_OUTPUTS,
}
