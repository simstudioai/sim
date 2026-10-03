import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningUploadFileParams,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/upload_application_snapshot.html */
export const oracleEpmPlanningUploadFileTool: InternalToolConfig<
  OracleEpmPlanningUploadFileParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_upload_file',
  name: 'Oracle EPM Planning Upload File',
  description:
    'Upload one authorized Sim file in sequential chunks of at most 50 MiB. Existing files are never overwritten. Sim inputs are limited to 5 GiB; Oracle may impose additional limits.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    file: { ...oracleEpmPlanningParamFields.file, required: true },
    fileName: { ...oracleEpmPlanningParamFields.fileName, required: false },
    maxWaitSeconds: { ...oracleEpmPlanningParamFields.maxWaitSeconds, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    upload: {
      type: 'json',
      description: 'Completed upload',
      properties: {
        fileName: {
          type: 'string',
          description: 'Repository file name',
        },
        size: {
          type: 'number',
          description: 'Uploaded bytes',
        },
        status: {
          type: 'number',
          description: 'Oracle completion status (0)',
        },
      },
    },
  },
}
