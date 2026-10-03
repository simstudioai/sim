import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsDeleteFileParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/delete_files_v3.html */
export const oracleEpmFccsDeleteFileTool: InternalToolConfig<FccsDeleteFileParams, FccsResponse> = {
  id: 'oracle_epm_fccs_delete_file',
  name: 'Oracle EPM FCCS Delete File',
  description: 'Delete an external Oracle repository file by exact path; excludes LCM snapshots.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    fileName: fccsParamFields.fileName,
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
