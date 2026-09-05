import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_TIME_CARD_OUTPUTS,
  type OracleFusionHcmGetTimeCardParams,
  type OracleFusionHcmGetTimeCardResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetTimeCardTool: InternalToolConfig<
  OracleFusionHcmGetTimeCardParams,
  OracleFusionHcmGetTimeCardResponse
> = {
  id: 'oracle_fusion_hcm_get_time_card',
  name: 'Get Time Card in Oracle Fusion HCM',
  description: 'Read an Oracle Fusion HCM time card by its documented ID, subject to tenant data access.',
  ...internalExecution,
  params: {
    ...common,
    timeRecordGroupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Time record group ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_GET_TIME_CARD_OUTPUTS,
}
