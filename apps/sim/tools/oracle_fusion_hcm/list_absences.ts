import { internalExecution, listCommon, personId } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_ABSENCES_OUTPUTS,
  type OracleFusionHcmListAbsencesParams,
  type OracleFusionHcmListAbsencesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListAbsencesTool: InternalToolConfig<
  OracleFusionHcmListAbsencesParams,
  OracleFusionHcmListAbsencesResponse
> = {
  id: 'oracle_fusion_hcm_list_absences',
  name: 'List Oracle Fusion HCM Absences',
  description: 'List a worker’s absences using documented Oracle finders.',
  ...internalExecution,
  params: {
    ...listCommon,
    ...personId,
    absenceTypeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional absence type ID',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Range start date (YYYY-MM-DD)',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Range end date (YYYY-MM-DD)',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_ABSENCES_OUTPUTS,
}
