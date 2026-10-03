import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { GROUP_SECURITY_ASSIGNMENT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementCreateGroupSecurityAssignmentTool = createRiskTool({
  id: 'oracle_fusion_risk_management_create_group_security_assignment',
  outputs: {
    record: {
      type: 'object',
      description: 'group security assignment fields',
      properties: GROUP_SECURITY_ASSIGNMENT_OUTPUT_PROPERTIES,
    },
  },
})
