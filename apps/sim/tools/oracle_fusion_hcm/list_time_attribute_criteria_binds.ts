import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_TIME_ATTRIBUTE_CRITERIA_BINDS_OUTPUTS,
  type OracleFusionHcmListTimeAttributeCriteriaBindsParams,
  type OracleFusionHcmListTimeAttributeCriteriaBindsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListTimeAttributeCriteriaBindsTool: InternalToolConfig<
  OracleFusionHcmListTimeAttributeCriteriaBindsParams,
  OracleFusionHcmListTimeAttributeCriteriaBindsResponse
> = {
  id: 'oracle_fusion_hcm_list_time_attribute_criteria_binds',
  name: 'List Time Attribute Criteria Binds in Oracle Fusion HCM',
  description:
    'Read one page of time attribute criteria binds from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    timeAttributeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Time attribute ID, as a positive decimal string',
    },
    dataSourceUsageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Data source usage ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_TIME_ATTRIBUTE_CRITERIA_BINDS_OUTPUTS,
}
