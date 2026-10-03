import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { SECURABLE_ELIGIBLE_USER_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetSecurableEligibleUserTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_securable_eligible_user',
  outputs: {
    record: {
      type: 'object',
      description: 'securable eligible user fields',
      properties: SECURABLE_ELIGIBLE_USER_OUTPUT_PROPERTIES,
    },
  },
})
