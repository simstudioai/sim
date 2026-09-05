import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'

export const oracleFusionRiskManagementDeleteGroupMemberTool = createRiskTool({
  id: 'oracle_fusion_risk_management_delete_group_member',
  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Oracle acknowledged deletion of the selected record or association',
    },
  },
})
