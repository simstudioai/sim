import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { GROUP_ELIGIBLE_USER_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetGroupEligibleUserTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_group_eligible_user',
  outputs: {
    record: {
      type: 'object',
      description: 'group eligible user fields',
      properties: GROUP_ELIGIBLE_USER_OUTPUT_PROPERTIES,
    },
  },
})
