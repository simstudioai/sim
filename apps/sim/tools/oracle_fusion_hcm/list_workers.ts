import { common, internalExecution, page, search } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_WORKERS_OUTPUTS,
  type OracleFusionHcmListWorkersParams,
  type OracleFusionHcmListWorkersResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListWorkersTool: InternalToolConfig<
  OracleFusionHcmListWorkersParams,
  OracleFusionHcmListWorkersResponse
> = {
  id: 'oracle_fusion_hcm_list_workers',
  name: 'List Oracle Fusion HCM Workers',
  description: 'List or safely search public worker profiles.',
  ...internalExecution,
  params: { ...common, ...search, ...page },
  outputs: ORACLE_FUSION_HCM_LIST_WORKERS_OUTPUTS,
}
