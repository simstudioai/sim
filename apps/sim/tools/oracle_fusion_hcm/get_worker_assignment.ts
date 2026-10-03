import { assignmentId, common, internalExecution, personId } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_ASSIGNMENT_OUTPUTS,
  type OracleFusionHcmGetWorkerAssignmentParams,
  type OracleFusionHcmGetWorkerAssignmentResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetWorkerAssignmentTool: InternalToolConfig<
  OracleFusionHcmGetWorkerAssignmentParams,
  OracleFusionHcmGetWorkerAssignmentResponse
> = {
  id: 'oracle_fusion_hcm_get_worker_assignment',
  name: 'Get Oracle Fusion HCM Worker Assignment',
  description: 'Get one assignment for a worker.',
  ...internalExecution,
  params: { ...common, ...personId, ...assignmentId },
  outputs: ORACLE_FUSION_HCM_GET_ASSIGNMENT_OUTPUTS,
}
