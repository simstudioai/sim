import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_SALARY_BASES_OUTPUTS,
  type OracleFusionHcmListSalaryBasesParams,
  type OracleFusionHcmListSalaryBasesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListSalaryBasesTool: InternalToolConfig<
  OracleFusionHcmListSalaryBasesParams,
  OracleFusionHcmListSalaryBasesResponse
> = {
  id: 'oracle_fusion_hcm_list_salary_bases',
  name: 'List Salary Bases in Oracle Fusion HCM',
  description:
    'Read one page of salary bases from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    legislativeDataGroupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Legislative data group ID, as a positive decimal string',
    },
    effectiveDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Effective date in YYYY-MM-DD format',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search text (maximum 200 characters)',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_SALARY_BASES_OUTPUTS,
}
