import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsResponse, FccsUploadFileParams } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/upload.html */
export const oracleEpmFccsUploadFileTool: InternalToolConfig<FccsUploadFileParams, FccsResponse> = {
  id: 'oracle_epm_fccs_upload_file',
  name: 'Oracle EPM FCCS Upload File',
  description:
    'Upload an authorized Sim UserFile of up to 100 MiB to the Oracle repository. Existing files are not overwritten.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    file: fccsParamFields.file,
    fileName: fccsParamFields.fileName,
    directory: { ...fccsParamFields.directory, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    status: {
      type: 'number',
      description: 'Repository operation status; 0 means success',
    },
    details: {
      type: 'string',
      description: 'Oracle operation details',
      optional: true,
      nullable: true,
    },
    fileName: {
      type: 'string',
      description: 'Requested repository filename',
    },
  },
}
