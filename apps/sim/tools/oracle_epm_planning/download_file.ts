import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningDownloadFileParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/download_application_snapshot_v2.html */
export const oracleEpmPlanningDownloadFileTool: InternalToolConfig<
  OracleEpmPlanningDownloadFileParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_download_file',
  name: 'Oracle EPM Planning Download File',
  description:
    'Download an Oracle repository file as a Sim UserFile, up to 100 MiB. Larger files must stay in Oracle. Temporary download resources are cleaned up.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    fileName: { ...oracleEpmPlanningParamFields.fileName, required: true },
    maxWaitSeconds: { ...oracleEpmPlanningParamFields.maxWaitSeconds, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    file: {
      type: 'file',
      description: 'Stored Sim UserFile (at most 100 MiB)',
    },
  },
}
