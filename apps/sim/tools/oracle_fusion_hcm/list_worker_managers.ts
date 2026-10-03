import {
  assignmentId,
  internalExecution,
  listCommon,
  personId,
} from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_MANAGERS_OUTPUTS,
  type OracleFusionHcmListWorkerManagersParams,
  type OracleFusionHcmListWorkerManagersResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListWorkerManagersTool: InternalToolConfig<
  OracleFusionHcmListWorkerManagersParams,
  OracleFusionHcmListWorkerManagersResponse
> = {
  id: 'oracle_fusion_hcm_list_worker_managers',
  name: 'List Oracle Fusion HCM Worker Managers',
  description: 'List managers for a worker assignment.',
  ...internalExecution,
  params: { ...listCommon, ...personId, ...assignmentId },
  outputs: ORACLE_FUSION_HCM_LIST_MANAGERS_OUTPUTS,
}
