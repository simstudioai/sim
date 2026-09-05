import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_GRADE_RATE_VALUES_OUTPUTS,
  type OracleFusionHcmListGradeRateValuesParams,
  type OracleFusionHcmListGradeRateValuesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListGradeRateValuesTool: InternalToolConfig<
  OracleFusionHcmListGradeRateValuesParams,
  OracleFusionHcmListGradeRateValuesResponse
> = {
  id: 'oracle_fusion_hcm_list_grade_rate_values',
  name: 'List Grade Rate Values in Oracle Fusion HCM',
  description: 'Read one page of grade rate values from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    gradeRateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Grade rate ID, as a positive decimal string',
    },
    effectiveDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Effective date in YYYY-MM-DD format',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_GRADE_RATE_VALUES_OUTPUTS,
}
