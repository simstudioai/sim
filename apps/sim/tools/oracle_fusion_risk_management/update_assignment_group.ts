import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { ASSIGNMENT_GROUP_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementUpdateAssignmentGroupTool = createRiskTool({
  id: 'oracle_fusion_risk_management_update_assignment_group',
  outputs: {
    record: {
      type: 'object',
      description: 'assignment group fields',
      properties: ASSIGNMENT_GROUP_OUTPUT_PROPERTIES,
    },
  },
})
