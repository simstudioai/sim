import { internalExecution, listCommon, personId } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_ASSIGNMENTS_OUTPUTS,
  type OracleFusionHcmListWorkerAssignmentsParams,
  type OracleFusionHcmListWorkerAssignmentsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListWorkerAssignmentsTool: InternalToolConfig<
  OracleFusionHcmListWorkerAssignmentsParams,
  OracleFusionHcmListWorkerAssignmentsResponse
> = {
  id: 'oracle_fusion_hcm_list_worker_assignments',
  name: 'List Oracle Fusion HCM Worker Assignments',
  description: 'List assignments for a worker.',
  ...internalExecution,
  params: { ...listCommon, ...personId },
  outputs: ORACLE_FUSION_HCM_LIST_ASSIGNMENTS_OUTPUTS,
}
