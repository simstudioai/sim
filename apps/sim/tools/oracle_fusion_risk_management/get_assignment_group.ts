import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { ASSIGNMENT_GROUP_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetAssignmentGroupTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_assignment_group',
  outputs: {
    record: {
      type: 'object',
      description: 'assignment group fields',
      properties: ASSIGNMENT_GROUP_OUTPUT_PROPERTIES,
    },
  },
})
