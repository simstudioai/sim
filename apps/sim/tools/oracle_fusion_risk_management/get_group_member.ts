import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { GROUP_MEMBER_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetGroupMemberTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_group_member',
  outputs: {
    record: {
      type: 'object',
      description: 'group member fields',
      properties: GROUP_MEMBER_OUTPUT_PROPERTIES,
    },
  },
})
