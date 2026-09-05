import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { GROUP_MEMBER_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementCreateGroupMemberTool = createRiskTool({
  id: 'oracle_fusion_risk_management_create_group_member',
  outputs: {
    record: {
      type: 'object',
      description: 'group member fields',
      properties: GROUP_MEMBER_OUTPUT_PROPERTIES,
    },
  },
})
