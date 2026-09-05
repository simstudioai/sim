import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_ABSENCE_OUTPUTS,
  type OracleFusionHcmGetAbsenceParams,
  type OracleFusionHcmGetAbsenceResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetAbsenceTool: InternalToolConfig<
  OracleFusionHcmGetAbsenceParams,
  OracleFusionHcmGetAbsenceResponse
> = {
  id: 'oracle_fusion_hcm_get_absence',
  name: 'Get Oracle Fusion HCM Absence',
  description: 'Get one absence entry by ID.',
  ...internalExecution,
  params: {
    ...common,
    absenceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Oracle absence entry ID',
    },
  },
  outputs: ORACLE_FUSION_HCM_GET_ABSENCE_OUTPUTS,
}
