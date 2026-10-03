import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_TIME_ATTRIBUTES_OUTPUTS,
  type OracleFusionHcmListTimeAttributesParams,
  type OracleFusionHcmListTimeAttributesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListTimeAttributesTool: InternalToolConfig<
  OracleFusionHcmListTimeAttributesParams,
  OracleFusionHcmListTimeAttributesResponse
> = {
  id: 'oracle_fusion_hcm_list_time_attributes',
  name: 'List Time Attributes in Oracle Fusion HCM',
  description:
    'Read one page of time attributes from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search text (maximum 200 characters)',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_TIME_ATTRIBUTES_OUTPUTS,
}
