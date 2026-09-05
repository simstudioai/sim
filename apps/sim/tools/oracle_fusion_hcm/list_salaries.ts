import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_SALARIES_OUTPUTS,
  type OracleFusionHcmListSalariesParams,
  type OracleFusionHcmListSalariesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListSalariesTool: InternalToolConfig<
  OracleFusionHcmListSalariesParams,
  OracleFusionHcmListSalariesResponse
> = {
  id: 'oracle_fusion_hcm_list_salaries',
  name: 'List Salaries in Oracle Fusion HCM',
  description: 'Read one page of salaries from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    assignmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'HR assignment ID (not payroll assignment ID), as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_SALARIES_OUTPUTS,
}
