import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsDownloadFileParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/download.html */
export const oracleEpmFccsDownloadFileTool: InternalToolConfig<
  FccsDownloadFileParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_download_file',
  name: 'Oracle EPM FCCS Download File',
  description:
    'Download an external repository file as a Sim UserFile (up to 100 MiB). Oversize errors do not imply the Oracle export failed.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    fileName: fccsParamFields.fileName,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    file: {
      type: 'file',
      description: 'Bounded stored Sim UserFile (100 MiB maximum)',
    },
    fileName: {
      type: 'string',
      description: 'Oracle repository source filename',
    },
  },
}
