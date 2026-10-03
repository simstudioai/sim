import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmResponse,
  OracleEpcmUploadFileParams,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_DELETE_FILE_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmUploadFileTool: InternalToolConfig<
  OracleEpcmUploadFileParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_upload_file',
  name: 'Oracle EPCM Upload File',
  description:
    'Upload one authorized Sim file, at most 100 MB, as an ordinary repository file. Oracle rejects existing names; snapshot extraction is unsupported.',
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
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'One canonical Sim UserFile (or one-element file-upload array)',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_DELETE_FILE_OUTPUTS,
}
