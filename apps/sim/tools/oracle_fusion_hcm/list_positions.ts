import { internalExecution, searchable } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_POSITIONS_OUTPUTS,
  type OracleFusionHcmListPositionsParams,
  type OracleFusionHcmListPositionsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListPositionsTool: InternalToolConfig<
  OracleFusionHcmListPositionsParams,
  OracleFusionHcmListPositionsResponse
> = {
  id: 'oracle_fusion_hcm_list_positions',
  name: 'List Oracle Fusion HCM Positions',
  description: 'List or search positions.',
  ...internalExecution,
  params: searchable,
  outputs: ORACLE_FUSION_HCM_LIST_POSITIONS_OUTPUTS,
}
