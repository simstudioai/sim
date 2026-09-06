import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmDownloadFileParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_DOWNLOAD_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmDownloadFileTool: InternalToolConfig<
  OraclePcmDownloadFileParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_download_file',
  name: 'Oracle PCM Download File',
  description:
    'Download one listed PCM repository file as a Sim UserFile, up to 100 MiB. Requires Service Administrator or an application role with Migrations - Administer.',
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
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_DOWNLOAD_OUTPUTS,
}
