import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  GROUP_ELIGIBLE_USER_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListGroupEligibleUsersTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_group_eligible_users',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of group eligible user records',
      items: { type: 'object', properties: GROUP_ELIGIBLE_USER_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
