import { common, internalExecution, personId } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_WORKER_OUTPUTS,
  type OracleFusionHcmGetWorkerParams,
  type OracleFusionHcmGetWorkerResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetWorkerTool: InternalToolConfig<
  OracleFusionHcmGetWorkerParams,
  OracleFusionHcmGetWorkerResponse
> = {
  id: 'oracle_fusion_hcm_get_worker',
  name: 'Get Oracle Fusion HCM Worker',
  description: 'Get one public worker profile by person ID.',
  ...internalExecution,
  params: { ...common, ...personId },
  outputs: ORACLE_FUSION_HCM_GET_WORKER_OUTPUTS,
}
