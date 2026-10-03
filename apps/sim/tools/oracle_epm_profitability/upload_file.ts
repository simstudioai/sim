import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmResponse,
  OraclePcmUploadFileParams,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_FILE_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmUploadFileTool: InternalToolConfig<
  OraclePcmUploadFileParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_upload_file',
  name: 'Oracle PCM Upload File',
  description:
    'Upload one authorized Sim file to profitinbox, up to 100 MiB. Existing names are rejected. Requires Service Administrator or an application role with Migrations - Administer.',
  version: '1.0.0',
  oauth: oraclePcmOAuth,
  params: {
    ...oraclePcmAuthParams,
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Filename without a folder for upload/import/export; download uses the listed profitoutbox path',
    },
    file: {
      type: 'file',
      required: true,
      visibility: 'user-or-llm',
      description: 'One canonical Sim UserFile or one-element upload array',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_FILE_OUTPUTS,
}
