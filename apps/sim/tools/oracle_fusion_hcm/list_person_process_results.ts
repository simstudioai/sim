import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_PERSON_PROCESS_RESULTS_OUTPUTS,
  type OracleFusionHcmListPersonProcessResultsParams,
  type OracleFusionHcmListPersonProcessResultsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListPersonProcessResultsTool: InternalToolConfig<
  OracleFusionHcmListPersonProcessResultsParams,
  OracleFusionHcmListPersonProcessResultsResponse
> = {
  id: 'oracle_fusion_hcm_list_person_process_results',
  name: 'List Person Process Results in Oracle Fusion HCM',
  description:
    'Read one page of person process results from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    personNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Worker person number, including any leading zeros; does not require current public-directory membership',
    },
    personId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Person ID, as a positive decimal string',
    },
    payrollRelationshipId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payroll relationship ID, as a positive decimal string',
    },
    payrollId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payroll ID, as a positive decimal string',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date in YYYY-MM-DD format',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date in YYYY-MM-DD format',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_PERSON_PROCESS_RESULTS_OUTPUTS,
}
