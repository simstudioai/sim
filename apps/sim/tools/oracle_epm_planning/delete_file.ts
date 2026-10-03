import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningDeleteFileParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/delete_files_v2.html */
export const oracleEpmPlanningDeleteFileTool: InternalToolConfig<
  OracleEpmPlanningDeleteFileParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_delete_file',
  name: 'Oracle EPM Planning Delete File',
  description:
    'Permanently delete the named Oracle repository file or snapshot. This cannot be undone by the integration.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    fileName: { ...oracleEpmPlanningParamFields.fileName, required: true },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Deletion completed',
    },
  },
}
