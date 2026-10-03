import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  RISK_PAGINATION_OUTPUTS,
  SECURABLE_ELIGIBLE_USER_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListSecurableEligibleUsersTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_securable_eligible_users',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of securable eligible user records',
      items: { type: 'object', properties: SECURABLE_ELIGIBLE_USER_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
